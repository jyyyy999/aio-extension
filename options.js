import { DEFAULT_SETTINGS } from "./defaults.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

let settings = await send({ type: "getSettings" });

function fillForm() {
  const d = settings.discord;
  $("token").value = d.token;
  $("channels").value = d.channels.join(", ");
  $("reopen").value = d.reopenSeconds;
  $("keywords").value = d.keywords.join(", ");
  $("skip").value = d.skipKeywords.join(", ");
  $("webhookOnly").checked = d.webhookOnly;
  $("newWindow").checked = d.newWindow;
  $("npayMatch").value = settings.pins.npay.match.join(", ");
  $("lpayMatch").value = settings.pins.lpay.match.join(", ");
  $("trusted").value = settings.trustedClick;
  $("flows").value = JSON.stringify(settings.flows, null, 2);
  $("autofillRules").value = (settings.autofill.fields || [])
    .map((f) => `${f.label || f.selector} = ${f.value}`).join("\n");
}

/** "칸 이름 = 값" 줄들을 fields 로. selector 로 짚고 싶으면 이름 자리에 #css 를 적는다. */
function parseFields(text) {
  return text.split("\n").map((line) => {
    const at = line.indexOf("=");
    if (at < 0) return null;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!key || !value) return null;
    return key.startsWith("#") || key.startsWith(".") || key.startsWith("[")
      ? { selector: key, value } : { label: key, value };
  }).filter(Boolean);
}

/** 지금 열려 있는 탭에 "어떤 입력 칸이 있나" 를 물어본다. 값은 받아 오지 않는다. */
async function readFields() {
  const note = $("fieldsNote");
  const list = $("fieldList");
  list.textContent = "";
  note.textContent = "읽는 중…";
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let got = null;
  try {
    got = tab && (await chrome.tabs.sendMessage(tab.id, { type: "listFields" }));
  } catch {
    got = null;
  }
  if (!got) {
    note.textContent = "그 탭에서 읽지 못했습니다 — 상품 페이지를 띄운 탭을 앞에 두고(이 설정 창은 뒤에 둔 채) 다시 눌러 주세요.";
    note.className = "note err";
    return;
  }
  note.className = "note";
  if (!got.fields.length) {
    note.textContent = "그 화면에는 글씨를 쓰는 칸이 없습니다 (옵션 칸은 구매 레이어 안에 있을 수 있습니다).";
    return;
  }
  note.textContent = `${new URL(got.url).host} — 칸 ${got.fields.length}개. 넣고 싶은 칸의 + 를 누르세요.`;
  for (const f of got.fields) {
    const name = f.names[0] || "(이름 없음)";
    const row = document.createElement("div");
    row.className = "row";
    const add = document.createElement("button");
    add.textContent = "+";
    add.title = "아래 칸 목록에 넣기";
    add.onclick = () => {
      const box = $("autofillRules");
      box.value = (box.value ? box.value.replace(/\s*$/, "\n") : "") + `${name} = `;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    };
    const text = document.createElement("span");
    text.className = "note";
    text.textContent = `${name}  ·  ${f.type}${f.max ? ` · ${f.max}자까지` : ""}${f.filled ? " · 이미 적혀 있음" : ""}`;
    row.append(add, text);
    list.append(row);
  }
}

async function showDiscord() {
  const st = await send({ type: "discordStatus" });
  $("dstate").textContent = `${st.state}${st.detail ? " — " + st.detail : ""}`;
}

$("save").onclick = async () => {
  let flows;
  try {
    flows = JSON.parse($("flows").value);
    if (!Array.isArray(flows)) throw new Error("맨 바깥이 [ ] 목록이어야 합니다");
    const ids = new Set();
    for (const f of flows) {
      if (!f.id || !f.name || !Array.isArray(f.match) || !Array.isArray(f.steps)) {
        throw new Error("흐름마다 id · name · match[] · steps[] 가 있어야 합니다");
      }
      if (ids.has(f.id)) throw new Error(`id 가 겹칩니다: ${f.id}`);
      ids.add(f.id);
    }
  } catch (e) {
    $("saved").textContent = `흐름 JSON 오류 — ${e.message}`;
    $("saved").className = "note err";
    return;
  }
  const oldToken = settings.discord.token;
  settings.discord = {
    ...settings.discord,
    token: $("token").value.trim(),
    channels: list($("channels").value),
    reopenSeconds: Number($("reopen").value) || 60,
    keywords: list($("keywords").value),
    skipKeywords: list($("skip").value),
    webhookOnly: $("webhookOnly").checked,
    newWindow: $("newWindow").checked,
  };
  settings.pins.npay.match = list($("npayMatch").value);
  settings.pins.lpay.match = list($("lpayMatch").value);
  settings.trustedClick = $("trusted").value;
  settings.flows = flows;
  settings.autofill = { ...settings.autofill, fields: parseFields($("autofillRules").value) };
  await chrome.storage.local.set({ settings });
  if (oldToken !== settings.discord.token) await send({ type: "discordRestart" });
  $("saved").textContent = `저장했습니다 ${new Date().toTimeString().slice(0, 8)}`;
  $("saved").className = "note on";
  setTimeout(showDiscord, 1500);
};

$("defaults").onclick = () => {
  if (!confirm("흐름을 기본값으로 되돌릴까요? (저장을 눌러야 적용됩니다)")) return;
  $("flows").value = JSON.stringify(DEFAULT_SETTINGS.flows, null, 2);
};
$("resetFlows").onclick = async () => {
  await send({ type: "resetFlows" });
  $("saved").textContent = "진행 상태를 처음으로 돌렸습니다";
};
$("readFields").onclick = readFields;
$("testOpen").onclick = () => send({ type: "testOpen", url: "https://example.com" });
$("reconnect").onclick = async () => { await send({ type: "discordRestart" }); setTimeout(showDiscord, 1500); };

fillForm();
showDiscord();
