const loginPage = document.getElementById("loginPage");
const appPage = document.getElementById("appPage");
const currentUserEl = document.getElementById("currentUser");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const rememberMe = document.getElementById("rememberMe");
const loginButton = document.getElementById("loginButton");
const signupButton = document.getElementById("signupButton");
const logoutButton = document.getElementById("logoutButton");
const sidebarToggle = document.getElementById("sidebarToggle");
const navManage = document.getElementById("navManage");
const navItems = document.getElementById("navItems");
const navShopping = document.getElementById("navShopping");
const loginMessage = document.getElementById("loginMessage");
const listSelectManage = document.getElementById("listSelectManage");
const listSelectAdd = document.getElementById("listSelectAdd");
const listSelectShop = document.getElementById("listSelectShop");
const createListButton = document.getElementById("createListButton");
const newListTitle = document.getElementById("newListTitle");
const shareListButton = document.getElementById("shareListButton");
const shareUser = document.getElementById("shareUser");
const listMessage = document.getElementById("listMessage");
const itemLabel = document.getElementById("itemLabel");
const itemQuantity = document.getElementById("itemQuantity");
const itemUnit = document.getElementById("itemUnit");
const itemCategory = document.getElementById("itemCategory");
const addItemButton = document.getElementById("addItemButton");
const itemMessage = document.getElementById("itemMessage");
const itemTableBody = document.querySelector("#itemTable tbody");
const shoppingGroups = document.getElementById("shoppingGroups");
const finishShoppingButton = document.getElementById("finishShoppingButton");
const shoppingMessage = document.getElementById("shoppingMessage");
const managePage = document.getElementById("managePage");
const itemsPage = document.getElementById("itemsPage");
const shoppingPage = document.getElementById("shoppingPage");
const sidebar = document.getElementById("sidebar");

let lists = [];
let selectedListId = null;
let longPressTimer = null;

async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "אירעה שגיאה");
  }
  return data;
}

function setMessage(element, text, isError = false) {
  element.textContent = text || "";
  element.classList.toggle("error", isError);
}

function showLogin() {
  loginPage.classList.remove("hidden");
  appPage.classList.add("hidden");
  const remembered = localStorage.getItem("shopListUser");
  if (remembered) {
    loginUser.value = remembered;
    rememberMe.checked = true;
  }
}

function showApp(user) {
  currentUserEl.textContent = user;
  loginPage.classList.add("hidden");
  appPage.classList.remove("hidden");
  sidebar.classList.remove("collapsed");
}

function showPage(pageId) {
  [managePage, itemsPage, shoppingPage].forEach((page) => {
    page.classList.toggle("hidden", page.id !== pageId);
  });
  [navManage, navItems, navShopping].forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });
}

async function init() {
  try {
    const data = await fetchJson("/api/check");
    if (data.user) {
      showApp(data.user);
      await loadLists();
      showPage("managePage");
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

async function login() {
  try {
    const username = loginUser.value.trim();
    const password = loginPass.value;
    if (!username || !password) {
      return setMessage(loginMessage, "יש למלא שם משתמש וסיסמה", true);
    }
    const data = await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (rememberMe.checked) {
      localStorage.setItem("shopListUser", username);
    } else {
      localStorage.removeItem("shopListUser");
    }
    setMessage(loginMessage, "התחברת בהצלחה.");
    showApp(data.user);
    await loadLists();
    showPage("managePage");
  } catch (err) {
    setMessage(loginMessage, err.message, true);
  }
}

async function signup() {
  try {
    const username = loginUser.value.trim();
    const password = loginPass.value;
    if (!username || !password) {
      return setMessage(loginMessage, "יש למלא שם משתמש וסיסמה", true);
    }
    const data = await fetchJson("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (rememberMe.checked) {
      localStorage.setItem("shopListUser", username);
    }
    setMessage(loginMessage, "נרשמת בהצלחה.");
    showApp(data.user);
    await loadLists();
    showPage("managePage");
  } catch (err) {
    setMessage(loginMessage, err.message, true);
  }
}

async function logout() {
  await fetchJson("/api/logout", { method: "POST" });
  showLogin();
}

function getSelectedList() {
  return lists.find((list) => list.id === selectedListId) || lists[0] || null;
}

function renderListOptions() {
  [listSelectManage, listSelectAdd, listSelectShop].forEach((select) => {
    select.innerHTML = "";
    lists.forEach((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = `${list.title} (${list.owner === currentUserEl.textContent ? "בעלים" : "משותף"})`;
      select.appendChild(option);
    });
  });
  if (!selectedListId && lists.length > 0) {
    selectedListId = lists[0].id;
  }
  [listSelectManage, listSelectAdd, listSelectShop].forEach((select) => {
    select.value = selectedListId;
  });
}

function renderItems() {
  const shoppingList = getSelectedList();
  itemTableBody.innerHTML = "";
  if (!shoppingList) {
    itemTableBody.innerHTML = "<tr><td colspan=4>אין רשימה פעילה</td></tr>";
    shoppingGroups.innerHTML = "";
    return;
  }
  const sortedItems = [...shoppingList.items].sort((a, b) => a.checked - b.checked || a.label.localeCompare(b.label));
  sortedItems.forEach((item) => {
    const row = document.createElement("tr");
    if (item.checked) row.classList.add("checked");
    row.innerHTML = `
      <td>${item.label}</td>
      <td>${item.quantity} ${item.unit === "weight" ? "קילוגרם" : "יחידות"}</td>
      <td>${categoryTitle(item.category)}</td>
      <td>${item.checked ? "אסוף" : "ממתין"}</td>
    `;
    itemTableBody.appendChild(row);
  });
  renderShoppingView(sortedItems);
}

function categoryTitle(category) {
  switch (category) {
    case "vegis":
      return "ירקות ופירות";
    case "dairy":
      return "חלב ומוצרי חלב";
    case "meat":
      return "בשר ודגים";
    case "bakery":
      return "אפייה ומוצרי לחם";
    default:
      return "אחר";
  }
}

function renderShoppingView(items) {
  const groups = {
    vegis: [],
    dairy: [],
    meat: [],
    bakery: [],
    other: [],
  };
  items.forEach((item) => {
    const group = groups[item.category] || groups.other;
    group.push(item);
  });
  shoppingGroups.innerHTML = "";
  Object.entries(groups).forEach(([key, group]) => {
    if (!group.length) return;
    const section = document.createElement("div");
    section.className = "shopping-card";
    const header = document.createElement("h3");
    header.textContent = categoryTitle(key);
    section.appendChild(header);
    group.forEach((item) => {
      const card = document.createElement("div");
      card.className = `shopping-card${item.checked ? " checked" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.checked;
      checkbox.dataset.itemId = item.id;
      checkbox.addEventListener("change", () => toggleItem(item, checkbox.checked));
      checkbox.addEventListener("pointerdown", (event) => startLongPress(item, event));
      checkbox.addEventListener("pointerup", stopLongPress);
      checkbox.addEventListener("pointerleave", stopLongPress);
      card.appendChild(checkbox);
      const content = document.createElement("div");
      content.innerHTML = `<strong>${item.label}</strong><small>${item.quantity} ${item.unit === "weight" ? "קילוגרם" : "יחידות"}</small>`;
      card.appendChild(content);
      section.appendChild(card);
    });
    shoppingGroups.appendChild(section);
  });
}

function startLongPress(item, event) {
  event.preventDefault();
  longPressTimer = setTimeout(async () => {
    const partial = prompt(`כמה קנית?\nנדרש: ${item.quantity}`);
    if (!partial) {
      return;
    }
    const partialQty = parseFloat(partial);
    if (Number.isNaN(partialQty) || partialQty <= 0) {
      alert("הכנס כמות חוקית");
      return;
    }
    await postItemCheck(item.id, "partial", partialQty);
    await loadLists();
  }, 600);
}

function stopLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

async function toggleItem(item, checked) {
  if (checked) {
    await postItemCheck(item.id, "check");
  } else {
    await postItemCheck(item.id, "uncheck");
  }
  await loadLists();
}

async function postItemCheck(itemId, action, partialQuantity = null) {
  const payload = { list_id: selectedListId, item_id: itemId, action };
  if (partialQuantity !== null) {
    payload.partial_quantity = partialQuantity;
  }
  await fetchJson("/api/list/item/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function loadLists() {
  try {
    const data = await fetchJson("/api/lists");
    lists = data.lists;
    if (!lists.length) {
      [listSelectManage, listSelectAdd, listSelectShop].forEach((select) => (select.innerHTML = ""));
      itemTableBody.innerHTML = "<tr><td colspan=4>אין רשימות זמינות</td></tr>";
      shoppingGroups.innerHTML = "";
      return;
    }
    if (!selectedListId || !lists.some((list) => list.id === selectedListId)) {
      selectedListId = lists[0].id;
    }
    renderListOptions();
    renderItems();
  } catch (err) {
    setMessage(listMessage, err.message, true);
  }
}

async function createList() {
  try {
    const title = newListTitle.value.trim();
    if (!title) {
      return setMessage(listMessage, "יש להזין שם רשימה", true);
    }
    const data = await fetchJson("/api/list/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    newListTitle.value = "";
    selectedListId = data.list.id;
    await loadLists();
    setMessage(listMessage, "הרשימה נוצרה בהצלחה.");
  } catch (err) {
    setMessage(listMessage, err.message, true);
  }
}

async function shareList() {
  try {
    const username = shareUser.value.trim();
    if (!username) {
      return setMessage(listMessage, "יש להזין שם משתמש לשיתוף", true);
    }
    await fetchJson("/api/list/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list_id: selectedListId, username }),
    });
    shareUser.value = "";
    setMessage(listMessage, "המשתמש נוסף לרשימה.");
    await loadLists();
  } catch (err) {
    setMessage(listMessage, err.message, true);
  }
}

async function addItem() {
  try {
    const label = itemLabel.value.trim();
    const quantity = itemQuantity.value.trim();
    const unit = itemUnit.value;
    const category = itemCategory.value;
    if (!label || !quantity) {
      return setMessage(itemMessage, "יש להזין שם מוצר וכמות", true);
    }
    await fetchJson("/api/list/item/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list_id: selectedListId, label, quantity, unit, category }),
    });
    itemLabel.value = "";
    itemQuantity.value = "";
    await loadLists();
    setMessage(itemMessage, "המוצר נוסף בהצלחה.");
  } catch (err) {
    setMessage(itemMessage, err.message, true);
  }
}

async function finishShopping() {
  try {
    await fetchJson("/api/list/shopping/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list_id: selectedListId }),
    });
    await loadLists();
    setMessage(shoppingMessage, "הקנייה הושלמה והפריטים המסומנים נמחקו.");
  } catch (err) {
    setMessage(shoppingMessage, err.message, true);
  }
}

function selectList(listId) {
  selectedListId = listId;
  [listSelectManage, listSelectAdd, listSelectShop].forEach((select) => {
    select.value = listId;
  });
  renderItems();
}

[listSelectManage, listSelectAdd, listSelectShop].forEach((select) => {
  select.addEventListener("change", () => selectList(select.value));
});
navManage.addEventListener("click", () => showPage("managePage"));
navItems.addEventListener("click", () => showPage("itemsPage"));
navShopping.addEventListener("click", () => showPage("shoppingPage"));
sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("collapsed"));
loginButton.addEventListener("click", login);
signupButton.addEventListener("click", signup);
logoutButton.addEventListener("click", logout);
createListButton.addEventListener("click", createList);
shareListButton.addEventListener("click", shareList);
addItemButton.addEventListener("click", addItem);
finishShoppingButton.addEventListener("click", finishShopping);

init();
