import { DEFAULT_SETTINGS } from "./defaults.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

let settings = await send({ type: "getSettings" });

function fillForm() {
  const d = settings.discord;
  $("token").value = d.token;
  $("channels").value = d.channels.join(", ");
  $("keywords").value = d.keywords.join(", ");
  $("skip").value = d.skipKeywords.join(", ");
  $("everyoneToUrl").value = d.everyoneToUrl || "";
  $("openLink").checked = d.openLink;
  $("newWindow").checked = d.newWindow;
  $("reopenSeconds").value = d.reopenSeconds;
  $("npayMatch").value = settings.pins.npay.match.join(", ");
  $("lpayMatch").value = settings.pins.lpay.match.join(", ");
  $("trusted").value = settings.trustedClick;
  $("flows").value = JSON.stringify(settings.flows, null, 2);
  $("autofillRules").value = (settings.autofill.fields || [])
    .map((f) => `${f.label || f.selector} = ${(f.values && f.values.length ? f.values : [f.value]).join(" | ")}`).join("\n");
  $("picker").checked = settings.autofill.picker !== false;
  $("choices").value = (settings.autofill.choices || []).join("\n");
}

/** "칸 이름 = 값" 줄들을 fields 로. 값은 `|` 로 여럿 적을 수 있다 (첫 값이 자동 입력, 전부 팝업 선택지).
 *  selector 로 짚고 싶으면 이름 자리에 #css 를 적는다. */
function parseFields(text) {
  return text.split("\n").map((line) => {
    const at = line.indexOf("=");
    if (at < 0) return null;
    const key = line.slice(0, at).trim();
    const values = line.slice(at + 1).split("|").map((v) => v.trim()).filter(Boolean);
    if (!key || !values.length) return null;
    const value = values[0];
    return key.startsWith("#") || key.startsWith(".") || key.startsWith("[")
      ? { selector: key, value, values } : { label: key, value, values };
  }).filter(Boolean);
}

/**
 * 가장 최근에 본 쇼핑 탭에 "어떤 입력 칸이 있나" 를 물어본다. 값은 받아 오지 않는다.
 * 설정 화면도 탭이라 이 버튼을 누르는 순간 설정 탭이 '현재 탭' 이 된다 — 그래서 현재 탭이 아니라
 * 마지막으로 본 웹 페이지 탭(네이버 주소가 든 것 먼저)을 읽는다.
 */
async function readFields() {
  const note = $("fieldsNote");
  const list = $("fieldList");
  list.textContent = "";
  note.textContent = "읽는 중…";
  const marks = (settings.autofill.match || []).filter(Boolean);
  const tabs = (await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const shop = (t) => marks.some((m) => (t.url || "").includes(m));
  const order = [...tabs.filter(shop), ...tabs.filter((t) => !shop(t))].slice(0, 6);
  let got = null;
  let from = null;
  for (const tab of order) {
    try {
      got = await chrome.tabs.sendMessage(tab.id, { type: "listFields" });
    } catch {
      got = null;
    }
    if (got) { from = tab; break; }
  }
  if (!got) {
    note.textContent = order.length
      ? "읽지 못했습니다 — 상품 페이지 탭을 새로고침(F5)한 뒤 구매하기로 옵션 레이어를 띄우고, 이 설정 탭으로 돌아와 다시 눌러 주세요 (익스텐션을 새로고침한 뒤에는 열려 있던 탭도 새로고침해야 합니다)."
      : "열려 있는 웹 페이지 탭이 없습니다 — 상품 페이지를 먼저 열어 주세요.";
    note.className = "note err";
    return;
  }
  note.className = "note";
  if (!got.fields.length) {
    note.textContent = `'${(from.title || "").slice(0, 30)}' (${new URL(got.url).host}) 에서 글씨를 쓰는 칸을 못 찾았습니다 — ` +
      `이 문서의 input·textarea 는 ${got.inputs}개 (옵션 칸이 구매 레이어 안이면 레이어를 띄운 채로 다시 눌러 보세요).`;
    return;
  }
  note.textContent = `'${(from.title || "").slice(0, 30)}' (${new URL(got.url).host}) — 칸 ${got.fields.length}개. 넣고 싶은 칸의 + 를 누르세요.`;
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
  const label = { on: "연결됨", connecting: "연결 중…", retry: "다시 연결하는 중", fatal: "멈춤", off: "꺼짐" }[st.state] || st.state;
  $("dstate").textContent = `${label}${st.detail ? " — " + st.detail : ""} · 연 것 ${st.opened || 0}건`;
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
    keywords: list($("keywords").value),
    skipKeywords: list($("skip").value),
    everyoneToUrl: $("everyoneToUrl").value.trim(),
    openLink: $("openLink").checked,
    newWindow: $("newWindow").checked,
    reopenSeconds: Math.max(0, Number($("reopenSeconds").value) || 0),
  };
  settings.pins.npay.match = list($("npayMatch").value);
  settings.pins.lpay.match = list($("lpayMatch").value);
  settings.trustedClick = $("trusted").value;
  settings.flows = flows;
  settings.autofill = { ...settings.autofill, picker: $("picker").checked,
    choices: [...new Set($("choices").value.split("\n").map((v) => v.trim()).filter(Boolean))], fields: parseFields($("autofillRules").value) };
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
$("reconnect").onclick = async () => { await send({ type: "discordRestart" }); setTimeout(showDiscord, 1500); };
$("testOpen").onclick = async () => {
  const got = await send({ type: "testOpen" });
  $("saved").textContent = got && got.ok !== false
    ? "시험용 창을 열었습니다 (설정한 대로 새 창/새 탭)"
    : `열기 실패: ${JSON.stringify(got)}`;
  $("saved").className = "note on";
};

fillForm();
showDiscord();
