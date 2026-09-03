const categories = [
  { id: "todos", label: "Todos", icon: "grid" },
  { id: "civil", label: "Registro Civil", icon: "document" },
  { id: "imoveis", label: "Imóveis", icon: "home" },
  { id: "notas", label: "Notas", icon: "notes" },
  { id: "protesto", label: "Protesto", icon: "gavel" },
  { id: "federais", label: "Federais / Estaduais", icon: "map" },
  { id: "pesquisa", label: "Pesquisa", icon: "search" },
  { id: "traducao", label: "Tradução / Apostilamento", icon: "translate" },
];

const services = window.viaServices || [];

const iconPaths = {
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  document: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/>',
  notes: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/><path d="m17 18 4-4"/>',
  gavel: '<path d="m14 5 5 5M12 7l5 5M4 20l9-9M3 21h8"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c.5 4 3 7 7 9M12 5c-.7 4-3.3 7.3-7 9"/><path d="m14 21 3.5-8 3.5 8M15.5 18h4"/>',
  alert: '<path d="M12 3a6 6 0 0 0-6 6c0 7-3 7-3 9h18c0-2-3-2-3-9a6 6 0 0 0-6-6Z"/><path d="M10 21h4"/>',
};

const state = {
  category: "todos",
  query: "",
  selected: null,
  cart: JSON.parse(localStorage.getItem("viaregistro-cart") || "[]"),
};

const els = {
  tabs: document.querySelector("#category-tabs"),
  list: document.querySelector("#documents-list"),
  count: document.querySelector("#result-count"),
  category: document.querySelector("#current-category"),
  search: document.querySelector("#search-input"),
  empty: document.querySelector("#empty-state"),
  modal: document.querySelector("#service-modal"),
  overlay: document.querySelector("#overlay"),
  drawer: document.querySelector("#cart-drawer"),
  infoModal: document.querySelector("#info-modal"),
  cartItems: document.querySelector("#cart-items"),
  cartCount: document.querySelector("#cart-count"),
  toast: document.querySelector("#toast"),
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.document}</svg>`;
}

function categoryLabel(id) {
  return categories.find((item) => item.id === id)?.label || "Todos";
}

function normalize(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function renderTabs() {
  els.tabs.innerHTML = categories.map((category) => `
    <button class="category-tab" type="button" role="tab" data-category="${category.id}"
      aria-selected="${state.category === category.id}">
      ${icon(category.icon)}<span>${category.label}</span>
    </button>
  `).join("");
}

function filteredServices() {
  const query = normalize(state.query.trim());
  return services.filter((service) => {
    const matchesCategory = state.category === "todos" || service.category === state.category;
    const matchesQuery = !query || normalize(`${service.name} ${categoryLabel(service.category)}`).includes(query);
    return matchesCategory && matchesQuery;
  });
}

function renderServices() {
  const visible = filteredServices();
  els.list.innerHTML = visible.map((service) => `
    <a class="document-card" href="servico.html?id=${encodeURIComponent(service.id)}" data-service="${service.id}">
      <span class="document-icon">${icon(service.icon)}</span>
      <span class="document-name">${service.name}<small class="document-meta">${categoryLabel(service.category)}</small></span>
      <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </a>
  `).join("");

  els.count.textContent = `${visible.length} ${visible.length === 1 ? "serviço" : "serviços"}`;
  els.category.textContent = state.query ? `Resultados para “${state.query.trim()}”` :
    state.category === "todos" ? "Todos os serviços" : categoryLabel(state.category);
  document.querySelector("#catalog-title").textContent = state.query
    ? `Resultados para “${state.query.trim()}”`
    : state.category === "todos" ? "Escolha uma opção abaixo" : categoryLabel(state.category);
  els.empty.hidden = visible.length > 0;
  els.list.hidden = visible.length === 0;
}

function setCategory(category) {
  state.category = category;
  renderTabs();
  renderServices();
  document.querySelector(`[data-category="${category}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function openLayer(element) {
  closeLayers(false);
  els.overlay.hidden = false;
  element.hidden = false;
  document.body.classList.add("is-locked");
  element.querySelector("button, input, a")?.focus();
}

function closeLayers(focusTrigger = true) {
  [els.modal, els.drawer, els.infoModal].forEach((element) => { element.hidden = true; });
  els.overlay.hidden = true;
  document.body.classList.remove("is-locked");
  if (focusTrigger) document.querySelector("#catalogo")?.focus?.();
}

function openService(service) {
  state.selected = service;
  document.querySelector("#modal-icon").innerHTML = icon(service.icon);
  document.querySelector("#modal-category").textContent = categoryLabel(service.category);
  document.querySelector("#modal-title").textContent = service.name;
  document.querySelector("#modal-description").textContent = service.description;
  const exists = state.cart.includes(service.id);
  const addButton = document.querySelector("#add-service");
  addButton.textContent = exists ? "Já está na minha solicitação" : "Adicionar à minha solicitação";
  addButton.disabled = exists;
  openLayer(els.modal);
}

function saveCart() {
  localStorage.setItem("viaregistro-cart", JSON.stringify(state.cart));
  renderCart();
}

function renderCart() {
  const selectedServices = state.cart.map((id) => services.find((service) => service.id === id)).filter(Boolean);
  els.cartCount.textContent = selectedServices.length;
  els.cartCount.hidden = selectedServices.length === 0;
  els.cartItems.innerHTML = selectedServices.length ? selectedServices.map((service) => `
    <div class="cart-item">
      <span class="document-icon">${icon(service.icon)}</span>
      <span><strong>${service.name}</strong><small>${categoryLabel(service.category)}</small></span>
      <button class="remove-item" type="button" data-remove="${service.id}" aria-label="Remover ${service.name}">×</button>
    </div>
  `).join("") : `
    <div class="cart-empty">
      ${icon("document")}
      <strong>Sua lista está vazia</strong>
      <span>Selecione os documentos que deseja solicitar.</span>
    </div>
  `;
  document.querySelector("#copy-request").hidden = selectedServices.length === 0;
  document.querySelector("#clear-cart").hidden = selectedServices.length === 0;
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

const infoContent = {
  "como-funciona": {
    title: "Como funciona",
    body: "<p><strong>1.</strong> Encontre o serviço desejado.</p><p><strong>2.</strong> Adicione os documentos à sua lista.</p><p><strong>3.</strong> Copie o resumo e envie ao canal de atendimento da empresa responsável pelo site.</p>"
  },
  privacidade: {
    title: "Privacidade",
    body: "<p>Esta versão não envia dados pessoais para servidores e salva a lista de documentos somente neste navegador.</p><p>Antes da operação comercial, publique a política de privacidade e configure um canal seguro para receber dados.</p>"
  },
  contato: {
    title: "Atendimento",
    body: "<p>Configure aqui o telefone, WhatsApp e e-mail oficiais da sua empresa antes de publicar o site.</p><p><strong>Horário sugerido:</strong> segunda a sexta, das 9h às 18h.</p>"
  }
};

function openInfo(key) {
  const info = infoContent[key];
  document.querySelector("#info-title").textContent = info.title;
  document.querySelector("#info-content").innerHTML = info.body;
  openLayer(els.infoModal);
}

els.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (button) setCategory(button.dataset.category);
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  renderServices();
});

document.querySelector("#clear-search").addEventListener("click", () => {
  els.search.value = "";
  state.query = "";
  setCategory("todos");
  els.search.focus();
});

document.querySelector("#add-service").addEventListener("click", () => {
  if (!state.selected || state.cart.includes(state.selected.id)) return;
  state.cart.push(state.selected.id);
  saveCart();
  closeLayers(false);
  showToast("Documento adicionado à sua solicitação.");
});

document.querySelector("#cart-button").addEventListener("click", () => {
  renderCart();
  openLayer(els.drawer);
});

els.cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  state.cart = state.cart.filter((id) => id !== button.dataset.remove);
  saveCart();
});

document.querySelector("#clear-cart").addEventListener("click", () => {
  state.cart = [];
  saveCart();
  showToast("Solicitação limpa.");
});

document.querySelector("#copy-request").addEventListener("click", async () => {
  const lines = state.cart.map((id, index) => `${index + 1}. ${services.find((service) => service.id === id)?.name}`).filter(Boolean);
  try {
    await navigator.clipboard.writeText(`Documentos solicitados:\n${lines.join("\n")}`);
    showToast("Lista copiada. Agora você pode enviar ao atendimento.");
  } catch {
    showToast("Não foi possível copiar automaticamente neste navegador.");
  }
});

document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeLayers()));
document.querySelectorAll("[data-open-info]").forEach((button) => button.addEventListener("click", () => openInfo(button.dataset.openInfo)));
els.overlay.addEventListener("click", () => closeLayers());

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    els.search.focus();
  }
  if (event.key === "Escape") closeLayers();
});

document.querySelector("#year").textContent = new Date().getFullYear();
renderTabs();
renderServices();
renderCart();
