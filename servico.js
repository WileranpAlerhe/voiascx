const params = new URLSearchParams(window.location.search);
const serviceId = params.get("id");
const services = window.viaServices || [];
const service = services.find((item) => item.id === serviceId);
const draftKey = service ? `viaregistro-draft-${service.id}` : "viaregistro-draft";
let currentStep = 1;
let priceCents = null;
let priceMode = "fixed";
let uploadedFileId = "";
let orderPolling = null;
let paymentTimer = null;
let paymentDeadline = 0;
let postalLookupSequence = 0;
let availableOffices = [];
const CNJ_API = "https://justicaabertaapi.cnj.jus.br/v1/api";
const cnjCitiesCache = new Map();

const $ = (selector) => document.querySelector(selector);

function setList(selector, items) {
  $(selector).innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function showToast(message) {
  const toast = $("#service-toast");
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2800);
}

function formatMoney(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatPostalCode(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

async function lookupPostalCode(value) {
  const input = $("#postal-code");
  const status = $("#postal-code-status");
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) {
    status.textContent = digits.length ? "Digite os 8 números do CEP" : "";
    return;
  }
  const sequence = ++postalLookupSequence;
  status.textContent = "Buscando endereço...";
  status.classList.remove("is-error");
  input.setAttribute("aria-busy", "true");
  try {
    let address;
    try {
      const response = await fetch(`/api/locations/cep?cep=${digits}`);
      address = await response.json();
      if (!response.ok || address.erro) throw new Error("Consulta local indisponível");
    } catch {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      address = await response.json();
      if (!response.ok || address.erro) throw new Error("CEP não encontrado");
    }
    if (sequence !== postalLookupSequence) return;
    $("#delivery-address").value = address.logradouro || "";
    $("#delivery-district").value = address.bairro || "";
    $("#delivery-city").value = [address.localidade, address.uf].filter(Boolean).join(" / ");
    status.textContent = "Endereço encontrado";
    status.classList.remove("is-error");
    saveDraft();
  } catch {
    if (sequence !== postalLookupSequence) return;
    status.textContent = "CEP não encontrado. Confira e tente novamente.";
    status.classList.add("is-error");
  } finally {
    if (sequence === postalLookupSequence) input.removeAttribute("aria-busy");
  }
}

function stopPaymentTimer() {
  window.clearInterval(paymentTimer);
  paymentTimer = null;
}

function expirePaymentModal() {
  stopPaymentTimer();
  window.clearInterval(orderPolling);
  $("#pix-dialog").classList.add("is-expired");
  $("#pix-timer").textContent = "00:00";
  $("#pix-timer-bar").style.width = "0%";
  $("#pix-expired-state").hidden = false;
  $("#copy-pix").disabled = true;
  $("#order-status").textContent = "Tempo de pagamento encerrado";
}

function updatePaymentTimer(totalSeconds) {
  const remaining = Math.max(0, Math.ceil((paymentDeadline - Date.now()) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  $("#pix-timer").textContent = `${minutes}:${seconds}`;
  $("#pix-timer-bar").style.width = `${Math.max(0, Math.min(100, remaining / totalSeconds * 100))}%`;
  if (remaining <= 0) expirePaymentModal();
}

function startPaymentTimer(seconds) {
  stopPaymentTimer();
  const totalSeconds = Math.min(300, Math.max(30, Number(seconds) || 300));
  paymentDeadline = Date.now() + totalSeconds * 1000;
  updatePaymentTimer(totalSeconds);
  paymentTimer = window.setInterval(() => updatePaymentTimer(totalSeconds), 1000);
}

function imageSource(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (source.startsWith("data:image/") || /^https?:\/\//i.test(source)) return source;
  return `data:image/png;base64,${source}`;
}

function openPaymentModal(result) {
  const dialog = $("#pix-dialog");
  const image = $("#pix-image");
  const loading = $("#pix-qr-loading");
  dialog.classList.remove("is-expired", "is-paid");
  $("#pix-expired-state").hidden = true;
  $("#pix-status-badge").innerHTML = "<i></i> Pix gerado";
  $("#pix-dialog-title").textContent = "Finalize seu pagamento";
  $("#pix-modal-subtitle").textContent = "Abra o app do seu banco e escaneie o QR Code ou copie o código Pix.";
  $("#pix-code").value = result.pixCode || "";
  $("#pix-amount").textContent = formatMoney(Number(result.amountCents) || priceCents);
  $("#copy-pix").disabled = !result.pixCode;
  $("#copy-pix span").textContent = "Copiar Pix";
  $("#order-status").textContent = `Pedido ${result.orderId} · aguardando pagamento`;
  const qrSource = imageSource(result.qrCodeImage);
  image.hidden = !qrSource;
  loading.hidden = Boolean(qrSource);
  if (qrSource) image.src = qrSource;
  else loading.innerHTML = "<strong>Use o Pix copia e cola</strong><small>O QR Code não foi enviado pela operadora.</small>";
  image.onerror = () => {
    image.hidden = true;
    loading.hidden = false;
    loading.innerHTML = "<strong>Use o Pix copia e cola</strong><small>Não foi possível exibir o QR Code.</small>";
  };
  startPaymentTimer(result.expiresIn);
  if (!dialog.open) dialog.showModal();
}

function markPaymentPaid() {
  stopPaymentTimer();
  const dialog = $("#pix-dialog");
  dialog.classList.add("is-paid");
  $("#pix-status-badge").innerHTML = "<i></i> Pagamento confirmado";
  $("#pix-dialog-title").textContent = "Pagamento recebido";
  $("#pix-modal-subtitle").textContent = "Seu pedido foi criado e já pode seguir para atendimento.";
  $("#order-status").textContent = "Pagamento confirmado. Seu pedido foi recebido.";
  $("#copy-pix").disabled = true;
}

function priceCopy() {
  if (priceMode === "subscription") return {
    label: "Mensalidade",
    value: priceCents ? `${formatMoney(priceCents)}/mês` : "Indisponível",
    detail: "Primeiro mês pago via Pix",
    note: "O valor corresponde ao primeiro ciclo mensal do monitoramento escolhido.",
  };
  if (priceMode === "location") return {
    label: "Valor-base estimado",
    value: priceCents ? formatMoney(priceCents) : "Após selecionar a localidade",
    detail: "Pagamento seguro via Pix",
    note: "Este é o valor-base da solicitação. Custas extraordinárias de localidade, formato ou entrega serão informadas antes de qualquer cobrança adicional.",
  };
  if (priceMode === "quote") return {
    label: "Orçamento personalizado",
    value: "Sob orçamento",
    detail: "Envie o arquivo para análise",
    note: "O valor é calculado conforme páginas, idioma, apostilamento e prazo. Nenhuma cobrança é feita antes da confirmação.",
  };
  return {
    label: "Valor do serviço",
    value: priceCents ? formatMoney(priceCents) : "Indisponível",
    detail: "Pagamento seguro via Pix",
    note: "O valor informado inclui as custas previstas e a assessoria da ViaRegistro para este serviço.",
  };
}

function renderPrice() {
  const copy = priceCopy();
  $("#flow-price-label").textContent = copy.label;
  $("#flow-price").textContent = copy.value;
  $("#flow-price-detail").textContent = copy.detail;
  $("#price-dock-label").textContent = copy.label;
  $("#price-dock-price").textContent = copy.value;
  $("#price-dock-detail").textContent = copy.detail;
  $("#price-dock-note").textContent = copy.note;
  $("#price-dock").hidden = false;
  document.body.classList.add("has-price-dock");
  $("#step-five-title").textContent = priceMode === "quote" ? "Revise e envie para orçamento" : "Revise e gere o Pix";
  $("#step-five-description").textContent = priceMode === "quote" ? "Nenhuma cobrança será criada nesta etapa." : "A cobrança é criada com segurança pela PinPay.";
  $("#payment-method-title").textContent = priceMode === "quote" ? "Análise do documento" : "Pix";
  $("#payment-method-description").textContent = priceMode === "quote" ? "A equipe confirma o valor antes de disponibilizar o pagamento." : "O código será exibido nesta tela após a confirmação.";
  $("#payment-badge").textContent = priceMode === "quote" ? "Orçamento sem cobrança" : "Pagamento via PinPay";
  if (currentStep === 5) renderSummary();
}

function escapeHTML(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML;
}

function field(name, label, options = {}) {
  const { type = "text", required = false, placeholder = "", wide = false, help = "", inputmode = "", rows = 0 } = options;
  const requiredMark = required ? " <em>*</em>" : "";
  const requiredAttr = required ? " required" : "";
  const mode = inputmode ? ` inputmode="${inputmode}"` : "";
  const content = rows
    ? `<textarea name="${name}" rows="${rows}" placeholder="${placeholder}"${requiredAttr}></textarea>`
    : `<input name="${name}" type="${type}" placeholder="${placeholder}"${mode}${requiredAttr} />`;
  return `<label class="${wide ? "form-wide" : ""}"><span class="field-label">${label}${requiredMark}</span>${content}${help ? `<small>${help}</small>` : ""}</label>`;
}

function selectField(name, label, values, required = false, wide = false) {
  return `<label class="${wide ? "form-wide" : ""}"><span class="field-label">${label}${required ? " <em>*</em>" : ""}</span><select name="${name}"${required ? " required" : ""}><option value="">Selecione</option>${values.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
}

function schemaFor(item) {
  const vehicleIds = new Set(["pesquisa-veiculo", "pesquisa-leilao", "pesquisa-gravame", "debitos-multas"]);
  const aircraftIds = new Set(["pesquisa-aeronave", "propriedade-aeronave"]);
  const processIds = new Set(["monitoramento-processos", "pesquisa-processos", "trf-distribuicao", "stf", "stj", "justica-estadual", "trt"]);
  const civilSearchIds = new Set(["pesquisa-nascimento", "pesquisa-casamento", "pesquisa-obito"]);
  if (item.category === "traducao") {
    return [
      selectField("sourceLanguage", "Idioma atual", [["pt", "Português"], ["en", "Inglês"], ["es", "Espanhol"], ["fr", "Francês"], ["de", "Alemão"], ["other", "Outro"]], true),
      selectField("targetLanguage", "Idioma de destino", [["pt", "Português"], ["en", "Inglês"], ["es", "Espanhol"], ["fr", "Francês"], ["de", "Alemão"], ["other", "Outro"]], item.id !== "apostilamento"),
      field("destinationCountry", "País de apresentação", { required: true }),
      `<label class="form-wide upload-field"><span class="field-label">Documento para orçamento <em>*</em></span><input name="documentFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required /><small>PDF, JPG, PNG ou WEBP de até 12 MB.</small><span id="upload-status"></span></label>`,
    ];
  }
  if (vehicleIds.has(item.id)) {
    return [field("plate", "Placa", { required: true, placeholder: "ABC1D23" }), field("renavam", "RENAVAM", { inputmode: "numeric" }), field("chassis", "Chassi", { wide: true }), field("ownerDocument", "CPF/CNPJ do proprietário", { inputmode: "numeric" })];
  }
  if (aircraftIds.has(item.id)) {
    return [field("aircraftPrefix", "Prefixo da aeronave", { required: true, placeholder: "Ex.: PR-ABC" }), field("ownerDocument", "CPF/CNPJ do proprietário", { inputmode: "numeric" }), field("aircraftSerial", "Número de série", { wide: true })];
  }
  if (item.category === "imoveis" || ["capa-iptu", "dados-cadastrais-imovel", "valor-venal", "iptu", "extrato-municipal", "cafir", "itr", "pesquisa-cadastro-rural"].includes(item.id)) {
    return [field("ownerName", "Nome do proprietário", { required: true }), field("ownerDocument", "CPF/CNPJ", { inputmode: "numeric" }), field("propertyAddress", "Endereço completo do imóvel", { required: true, wide: true }), field("registrationNumber", "Matrícula / inscrição imobiliária"), field("propertyType", "Tipo de imóvel")];
  }
  if (processIds.has(item.id)) {
    return [field("searchedName", "Nome completo pesquisado", { required: true, wide: true }), field("searchedDocument", "CPF/CNPJ", { required: true, inputmode: "numeric" }), selectField("scope", "Abrangência", [["civil", "Cível"], ["criminal", "Criminal"], ["both", "Cível e criminal"]], true), field("processNumber", "Número do processo, se souber")];
  }
  if (item.category === "civil" || civilSearchIds.has(item.id)) {
    return [field("registeredName", "Nome completo no registro", { required: true, wide: true }), field("recordDate", "Data aproximada do registro", { type: "date" }), field("motherName", "Nome da mãe", { required: true }), field("fatherName", "Nome do pai"), field("book", "Livro"), field("page", "Folha"), field("term", "Termo / matrícula", { wide: true })];
  }
  if (item.category === "notas") {
    return [field("firstParty", "Nome de uma das partes", { required: true }), field("secondParty", "Nome da outra parte"), field("actDate", "Data aproximada do ato", { type: "date" }), field("book", "Livro"), field("page", "Folha"), field("actDetails", "Outras informações", { rows: 3, wide: true, placeholder: "Descreva o que souber sobre o ato" })];
  }
  return [field("searchedName", "Nome ou razão social", { required: true, wide: true }), field("searchedDocument", "CPF ou CNPJ", { required: true, inputmode: "numeric" }), selectField("personType", "Tipo de pessoa", [["individual", "Pessoa física"], ["company", "Pessoa jurídica"]], true), field("period", "Período da pesquisa", { placeholder: "Ex.: últimos 5 anos" }), field("details", "Informações adicionais", { rows: 3, wide: true })];
}

function saveDraft() {
  if (!service) return;
  const values = Object.fromEntries(new FormData($("#request-form")).entries());
  delete values.documentFile;
  values.currentStep = String(currentStep);
  values.uploadedFileId = uploadedFileId;
  localStorage.setItem(draftKey, JSON.stringify(values));
}

function restoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch { return; }
  if (!draft) return;
  Object.entries(draft).forEach(([name, value]) => {
    if (["currentStep", "uploadedFileId", "city"].includes(name)) return;
    const input = document.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) return;
    if (input.type === "radio" || input.type === "checkbox") {
      const matching = document.querySelector(`[name="${CSS.escape(name)}"][value="${CSS.escape(String(value))}"]`);
      if (matching) matching.checked = true;
    } else input.value = value;
  });
  uploadedFileId = draft.uploadedFileId || "";
  toggleUnknownOffice(draft.unknownOffice === "yes");
  if (draft.state) {
    $("#request-state").value = draft.state;
    loadCities(draft.state, draft.city || "", draft.office || "");
  }
  $("#address-fields").hidden = draft.delivery !== "physical";
  $("#address-fields").querySelectorAll("input").forEach((input) => { input.required = draft.delivery === "physical" && input.name !== "addressExtra"; });
  if (draft.postalCode) $("#postal-code").value = formatPostalCode(draft.postalCode);
  const fileInput = document.querySelector('[name="documentFile"]');
  if (fileInput && uploadedFileId) {
    fileInput.required = false;
    $("#upload-status").textContent = "Arquivo já anexado.";
  }
}

async function loadCities(uf, selected = "", selectedOffice = "") {
  const city = $("#request-city");
  const status = $("#city-status");
  resetOffices("Selecione primeiro o município");
  city.disabled = true;
  city.innerHTML = `<option value="">Carregando municípios...</option>`;
  status.textContent = "Consultando municípios";
  try {
    let list;
    try {
      const response = await fetch(`/api/locations/municipios?uf=${encodeURIComponent(uf)}`);
      list = await response.json();
      if (!response.ok || !Array.isArray(list)) throw new Error("Falha na consulta local");
    } catch {
      list = await fetchCnjCities(uf);
    }
    city.innerHTML = `<option value="">Selecione o município</option>${list.map((item) => `<option value="${item.nome}">${item.nome}</option>`).join("")}`;
    city.disabled = false;
    if (selected) {
      city.value = selected;
      if (city.value) await loadOffices(uf, city.value, selectedOffice);
    }
    status.textContent = `${list.length} municípios encontrados`;
  } catch {
    city.innerHTML = `<option value="">Não foi possível carregar</option>`;
    status.textContent = "Tente selecionar o estado novamente";
  }
}

async function fetchCnjCities(uf) {
  if (cnjCitiesCache.has(uf)) return cnjCitiesCache.get(uf);
  const response = await fetch(`${CNJ_API}/cidades/listar/${encodeURIComponent(uf)}`);
  if (!response.ok) throw new Error("Municípios indisponíveis");
  const cities = await response.json();
  if (!Array.isArray(cities)) throw new Error("Resposta inválida de municípios");
  cnjCitiesCache.set(uf, cities);
  return cities;
}

async function fetchCnjOfficePage(uf, cityId, page) {
  const query = new URLSearchParams({ page: String(page), perPage: "100", assignments: "", search: "" });
  const response = await fetch(`${CNJ_API}/serventias?${query}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ cidade_id: cityId, uf, cns: null }),
  });
  if (!response.ok) throw new Error("Cartórios indisponíveis");
  return response.json();
}

async function fetchCnjOffices(uf, cityName) {
  const cities = await fetchCnjCities(uf);
  const city = cities.find((item) => normalizedSearch(item.nome) === normalizedSearch(cityName));
  if (!city) throw new Error("Município não localizado");
  const first = await fetchCnjOfficePage(uf, city.id, 1);
  const lastPage = Math.min(Math.max(Number(first.meta?.last_page) || 1, 1), 50);
  const remaining = await Promise.all(Array.from({ length: lastPage - 1 }, (_, index) => fetchCnjOfficePage(uf, city.id, index + 2)));
  const seen = new Set();
  return [first, ...remaining].flatMap((page) => page.data || []).map((office) => ({
    cns: String(office.cns || "").trim(),
    nome: String(office.denominacao_fantasia || office.denominacao_padrao || "Serventia sem denominação").trim(),
    natureza: String(office.natureza || "").trim(),
    status: String(office.status || "").trim(),
  })).filter((office) => {
    if (!office.cns || seen.has(office.cns)) return false;
    seen.add(office.cns);
    return true;
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
}

function officeLabel(office) {
  const details = [office.natureza, office.status && office.status.toLowerCase() !== "ativo" ? office.status : ""].filter(Boolean);
  return `${office.nome}${details.length ? ` — ${details.join(" · ")}` : ""}`;
}

function normalizedSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function resetOffices(message) {
  availableOffices = [];
  $("#request-office").disabled = true;
  $("#request-office").innerHTML = `<option value="">${escapeHTML(message)}</option>`;
  $("#office-filter").disabled = true;
  $("#office-filter").value = "";
  $("#office-status").textContent = "";
}

function renderOfficeOptions(selected = "") {
  const select = $("#request-office");
  const filter = normalizedSearch($("#office-filter").value.trim());
  const filtered = filter
    ? availableOffices.filter((office) => normalizedSearch(`${office.nome} ${office.natureza} ${office.cns}`).includes(filter))
    : availableOffices;
  select.innerHTML = `<option value="">Selecione o cartório ou órgão</option>${filtered.map((office) => `<option value="${escapeHTML(office.cns)}" data-name="${escapeHTML(office.nome)}">${escapeHTML(officeLabel(office))}</option>`).join("")}`;
  if (selected) {
    const match = availableOffices.find((office) => office.cns === selected || office.nome === selected);
    if (match && filtered.some((office) => office.cns === match.cns)) select.value = match.cns;
  }
  $("#office-status").textContent = filter ? `${filtered.length} de ${availableOffices.length} cartórios exibidos` : `${availableOffices.length} cartórios encontrados · fonte oficial CNJ`;
}

async function loadOffices(uf, city, selected = "") {
  const select = $("#request-office");
  const filter = $("#office-filter");
  const status = $("#office-status");
  availableOffices = [];
  select.disabled = true;
  filter.disabled = true;
  filter.value = "";
  select.innerHTML = `<option value="">Carregando cartórios...</option>`;
  status.textContent = "Consultando a base oficial do CNJ";
  try {
    try {
      const response = await fetch(`/api/locations/cartorios?uf=${encodeURIComponent(uf)}&city=${encodeURIComponent(city)}`);
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.offices)) throw new Error("Falha na consulta local");
      availableOffices = result.offices;
    } catch {
      availableOffices = await fetchCnjOffices(uf, city);
    }
    renderOfficeOptions(selected);
    toggleUnknownOffice($("#unknown-office").checked);
  } catch {
    select.innerHTML = `<option value="">Não foi possível carregar</option>`;
    status.textContent = "Marque a opção abaixo para solicitar a localização";
    filter.disabled = true;
  }
}

function toggleUnknownOffice(unknown) {
  const select = $("#request-office");
  const filter = $("#office-filter");
  select.required = !unknown;
  select.disabled = unknown || availableOffices.length === 0;
  filter.disabled = unknown || availableOffices.length === 0;
  if (unknown) select.value = "";
}

function setStep(step) {
  currentStep = Math.min(5, Math.max(1, step));
  document.querySelectorAll(".flow-step").forEach((panel) => {
    const active = Number(panel.dataset.step) === currentStep;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-progress]").forEach((item) => {
    const number = Number(item.dataset.progress);
    item.classList.toggle("is-active", number === currentStep);
    item.classList.toggle("is-complete", number < currentStep);
  });
  $("#previous-step").hidden = currentStep === 1;
  $("#next-step").hidden = currentStep === 5;
  $("#price-dock-step").textContent = `${currentStep} de 5`;
  if (currentStep === 5) renderSummary();
  saveDraft();
  $("#solicitar").scrollIntoView({ behavior: "smooth", block: "start" });
}

function validateStep(stepNumber) {
  const step = document.querySelector(`[data-step="${stepNumber}"]`);
  const required = [...step.querySelectorAll("[required]")].filter((input) => !input.closest("[hidden]") && !input.disabled);
  for (const input of required) {
    if (input.type === "radio") {
      if (!step.querySelector(`[name="${input.name}"]:checked`)) { input.reportValidity(); return false; }
    } else if (!input.checkValidity()) { input.reportValidity(); return false; }
  }
  return true;
}

async function uploadDocumentIfNeeded() {
  const fileInput = document.querySelector('[name="documentFile"]');
  if (!fileInput || !fileInput.files?.length || uploadedFileId) return true;
  const status = $("#upload-status");
  status.textContent = "Enviando arquivo com segurança...";
  const form = new FormData();
  form.set("file", fileInput.files[0]);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) { status.textContent = result.error || "Não foi possível enviar."; showToast(status.textContent); return false; }
  uploadedFileId = result.uploadId;
  status.textContent = "Arquivo anexado.";
  return true;
}

function collectRequest() {
  const data = Object.fromEntries(new FormData($("#request-form")).entries());
  delete data.documentFile;
  delete data.terms;
  data.uploadedFileId = uploadedFileId;
  const selectedOffice = $("#request-office").selectedOptions[0];
  data.officeName = data.unknownOffice === "yes" ? "" : (selectedOffice?.dataset.name || selectedOffice?.textContent || "");
  data.officeCns = data.unknownOffice === "yes" ? "" : (data.office || "");
  data.officeKnown = data.unknownOffice === "yes" ? "no" : "yes";
  return data;
}

function renderSummary() {
  const data = collectRequest();
  const delivery = data.delivery === "physical" ? "Documento físico" : "Documento digital";
  const office = data.officeKnown === "yes" ? data.officeName : "Localização do cartório incluída";
  $("#order-summary").innerHTML = `
    <h4>Resumo do pedido</h4>
    <dl>
      <div><dt>Serviço</dt><dd>${escapeHTML(service.name)}</dd></div>
      <div><dt>Localidade</dt><dd>${escapeHTML(data.city)} / ${escapeHTML(data.state)}</dd></div>
      <div><dt>Cartório / órgão</dt><dd>${escapeHTML(office)}</dd></div>
      <div><dt>Entrega</dt><dd>${delivery}</dd></div>
      <div><dt>Solicitante</dt><dd>${escapeHTML(data.customerName)}</dd></div>
      <div class="summary-total"><dt>${priceMode === "subscription" ? "Mensalidade" : priceMode === "location" ? "Valor-base" : "Total"}</dt><dd>${priceCopy().value}</dd></div>
    </dl>`;
  const pay = $("#pay-button");
  pay.disabled = priceMode !== "quote" && !priceCents;
  pay.textContent = priceMode === "quote" ? "Enviar para orçamento" : "Gerar Pix";
  $("#payment-message").textContent = priceMode === "quote" ? "Anexe o documento para receber o orçamento antes do pagamento." : priceCents ? "Ambiente protegido. Nenhuma chave de pagamento fica no navegador." : "O preço deste serviço precisa ser cadastrado antes de gerar o Pix.";
}

async function loadPrice() {
  let config = null;
  try {
    const response = await fetch(`/api/config?service=${encodeURIComponent(service.id)}`);
    if (response.ok) config = await response.json();
  } catch { /* o pacote estático usa o catálogo local */ }
  if (!config) {
    try {
      const response = await fetch("prices.json");
      const catalog = await response.json();
      config = catalog[service.id] || null;
    } catch { config = null; }
  }
  priceCents = Number.isInteger(config?.priceCents) ? config.priceCents : Number.isInteger(config?.amountCents) ? config.amountCents : null;
  priceMode = ["fixed", "location", "subscription", "quote"].includes(config?.priceMode) ? config.priceMode : ["fixed", "location", "subscription", "quote"].includes(config?.mode) ? config.mode : "fixed";
  renderPrice();
}

async function createPix(event) {
  event.preventDefault();
  if (!validateStep(4) || (priceMode !== "quote" && !priceCents)) return;
  const data = collectRequest();
  const button = $("#pay-button");
  const message = $("#payment-message");
  if (priceMode === "quote") {
    button.disabled = true;
    button.textContent = "Enviando...";
    message.textContent = "Registrando sua solicitação de orçamento.";
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, serviceName: service.name, customer: { name: data.customerName, email: data.customerEmail, phone: data.customerPhone, document: data.customerDocument }, request: data }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o orçamento.");
      $("#quote-result").hidden = false;
      $("#quote-status").textContent = `Protocolo ${result.orderId}. A ViaRegistro poderá confirmar o valor antes de qualquer cobrança.`;
      message.textContent = "Solicitação enviada com segurança.";
      localStorage.removeItem(draftKey);
    } catch (error) {
      message.textContent = error.message;
      showToast(error.message);
      button.disabled = false;
    } finally {
      button.textContent = "Enviar para orçamento";
    }
    return;
  }
  button.disabled = true;
  button.textContent = "Gerando Pix...";
  message.textContent = "Conectando à PinPay.";
  try {
    const response = await fetch("/api/checkout/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId: service.id, serviceName: service.name, customer: { name: data.customerName, email: data.customerEmail, phone: data.customerPhone, document: data.customerDocument }, request: data }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível gerar o Pix.");
    if (!result.pixCode && !result.qrCodeImage) throw new Error("A PinPay não retornou um Pix válido. Gere novamente.");
    openPaymentModal(result);
    message.textContent = "Pix criado com sucesso.";
    localStorage.removeItem(draftKey);
    startStatusPolling(result.orderId);
  } catch (error) {
    message.textContent = error.message;
    showToast(error.message);
    button.disabled = false;
  } finally {
    button.textContent = "Gerar Pix";
  }
}

function startStatusPolling(orderId) {
  window.clearInterval(orderPolling);
  orderPolling = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
      const order = await response.json();
      const approved = ["paid", "approved", "completed"].includes(String(order.status).toLowerCase());
      $("#order-status").textContent = approved ? "Pagamento confirmado. Seu pedido foi recebido." : `Status do pagamento: ${order.status}`;
      if (approved) { window.clearInterval(orderPolling); markPaymentPaid(); showToast("Pagamento confirmado."); }
    } catch { /* nova tentativa automática */ }
  }, 8000);
}

if (!service) {
  document.title = "Serviço não encontrado | ViaRegistro";
  $("#conteudo").innerHTML = `<section class="not-found"><h1>Serviço não encontrado</h1><p>O serviço informado não existe ou foi atualizado.</p><a class="hero-action" href="index.html#catalogo">Voltar ao catálogo</a></section>`;
} else {
  document.title = `${service.name} | ViaRegistro`;
  $('meta[name="description"]').setAttribute("content", service.description);
  $("#breadcrumb-category").textContent = service.categoryLabel;
  $("#breadcrumb-name").textContent = service.name;
  $("#service-category").textContent = service.immediate ? `${service.categoryLabel} · opção digital` : service.categoryLabel;
  $("#service-title").textContent = service.name;
  $("#service-description").textContent = service.description;
  $("#service-about").textContent = service.about;
  $("#price-dock-service").textContent = service.name;
  const image = $("#service-image");
  image.src = service.image;
  image.alt = `Documento relacionado a ${service.name}`;
  const imageButton = $("#open-image");
  imageButton.hidden = !service.hasDocumentPreview;
  if (service.hasDocumentPreview) imageButton.addEventListener("click", () => {
    $("#dialog-image").src = service.image;
    $("#dialog-image").alt = `Visualização ampliada: ${service.name}`;
    $("#image-dialog").showModal();
  });
  setList("#service-uses", service.uses);
  setList("#service-requirements", service.requirements);
  $("#dynamic-fields").innerHTML = schemaFor(service).join("");
  loadPrice();
  restoreDraft();

  $("#request-state").addEventListener("change", (event) => {
    const uf = event.target.value;
    if (uf) {
      loadCities(uf);
    } else {
      $("#request-city").disabled = true;
      $("#request-city").innerHTML = `<option value="">Selecione primeiro o estado</option>`;
      $("#city-status").textContent = "";
      resetOffices("Selecione primeiro o município");
    }
  });
  $("#request-city").addEventListener("change", (event) => {
    if (event.target.value) loadOffices($("#request-state").value, event.target.value);
  });
  $("#office-filter").addEventListener("input", () => renderOfficeOptions());
  $("#unknown-office").addEventListener("change", (event) => toggleUnknownOffice(event.target.checked));
  document.querySelectorAll('[name="delivery"]').forEach((input) => input.addEventListener("change", (event) => {
    const physical = event.target.value === "physical";
    $("#address-fields").hidden = !physical;
    $("#address-fields").querySelectorAll("input").forEach((field) => { field.required = physical && field.name !== "addressExtra"; });
  }));
  $("#postal-code").addEventListener("input", (event) => {
    const formatted = formatPostalCode(event.target.value);
    event.target.value = formatted;
    event.target.setCustomValidity(formatted.length === 9 ? "" : "Digite um CEP no formato 00000-000.");
    if (formatted.length === 9) lookupPostalCode(formatted);
    else {
      postalLookupSequence += 1;
      $("#postal-code-status").textContent = formatted ? "Digite os 8 números do CEP" : "";
      $("#postal-code-status").classList.remove("is-error");
    }
  });
  $("#request-form").addEventListener("input", saveDraft);
  $("#request-form").addEventListener("change", saveDraft);
  const fileInput = document.querySelector('[name="documentFile"]');
  if (fileInput) fileInput.addEventListener("change", () => {
    uploadedFileId = "";
    fileInput.required = true;
    $("#upload-status").textContent = "";
  });
  $("#next-step").addEventListener("click", async () => {
    if (!validateStep(currentStep)) return;
    if (currentStep === 2 && !(await uploadDocumentIfNeeded())) return;
    setStep(currentStep + 1);
  });
  $("#previous-step").addEventListener("click", () => setStep(currentStep - 1));
  $("#request-form").addEventListener("submit", createPix);
  $("#service-cart").addEventListener("click", () => $("#solicitar").scrollIntoView({ behavior: "smooth" }));
  $("#copy-pix").addEventListener("click", async () => {
    const code = $("#pix-code").value;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      $("#pix-code").select();
      document.execCommand("copy");
    }
    $("#copy-pix span").textContent = "Pix copiado ✓";
    showToast("Código Pix copiado.");
    window.setTimeout(() => { $("#copy-pix span").textContent = "Copiar Pix"; }, 1800);
  });
}

$("#close-image").addEventListener("click", () => $("#image-dialog").close());
$("#image-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$("#close-pix-dialog").addEventListener("click", () => $("#pix-dialog").close());
$("#pix-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$("#regenerate-pix").addEventListener("click", () => {
  $("#pix-dialog").close();
  const button = $("#pay-button");
  button.disabled = false;
  button.textContent = "Gerar Pix";
  $("#payment-message").textContent = "O Pix anterior expirou. Gere um novo código para pagar.";
  $("#pay-button").focus();
});
$("#year").textContent = new Date().getFullYear();
