const $ = (id) => document.getElementById(id);
const positions = ["QB", "RB", "WR", "TE", "K", "DST"];
let state = null;
let selected = null;
let matches = [];
let activeIndex = -1;
let busy = false;
let ready = false;
let sourceBeforeChange = "fantasypros";
let lastRecKey = "";
let pollTimer = null;
let liveConfirmOpen = false;

function roomWritable() {
  return !state?.room || state.room.writable;
}
function formatClock(seconds, label) {
  if (label) return label;
  if (seconds == null || Number.isNaN(Number(seconds))) return "";
  const sec = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remain = sec % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!days && (remain > 0 || parts.length === 0)) parts.push(`${remain} second${remain === 1 ? "" : "s"}`);
  return parts.join(" ");
}
function roomCopy(room) {
  const attached = room?.url || room?.targetUrl || "";
  if (!room || room.status === "disconnected") return { label: "Manual companion", note: "Record what happens in CBS here, or watch a draft room so picks appear automatically. Nothing in this companion submits a pick to your league.", detail: "" };
  if (room.status === "connecting") return { label: "Connecting to draft room", note: "Opening the draft room. Recording stays locked until the companion is reading it.", detail: attached };
  if (room.status === "awaiting_draft_room") return { label: "Waiting for CBS Draft Room", note: "Use the Chrome window this app opened, not another browser tab. Finish login there if needed. It is going to the live room and stays read-only.", detail: attached };
  if (room.status === "error") return { label: "Draft room error", note: room.error || "The draft room connection failed. You can record locally or try again.", detail: attached };
  if (room.kind === "live") return { label: "Watching CBS draft room", note: "This UI is reading CBS. Clock and new picks should match that Chrome window. Nothing here submits a pick.", detail: attached };
  return { label: "Watching local draft room", note: "Picks are coming from the local fake draft room. Disconnect to keep this board and record the rest by hand.", detail: attached };
}

// Provider and player text is inserted as text, never interpreted as HTML.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function positionBadge(position) {
  const badge = element("span", "position", position);
  badge.dataset.position = position;
  return badge;
}
function announce(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function updateControls() {
  const writable = roomWritable();
  const watching = Boolean(state?.room && !state.room.writable);
  $("playerSearch").disabled = busy || !ready || !writable;
  $("sourceSelect").disabled = busy || !ready;
  $("submitPick").disabled = busy || !ready || !writable || !selected;
  $("undoBtn").disabled = busy || !ready || !writable || !state?.draftedCount;
  $("resetBtn").disabled = busy || !ready || !writable || !state?.draftedCount;
  $("confirmReset").disabled = busy || !ready || !writable;
  $("clearSearch").disabled = busy;
  $("watchFixtureBtn").disabled = busy || !ready || watching;
  $("watchLiveBtn").disabled = busy || !ready || watching || !state?.room?.liveAllowed;
  $("disconnectRoomBtn").disabled = busy || !ready || !watching;
  $("confirmLive").disabled = busy || !ready || watching;
  document.querySelectorAll(".select-rec").forEach((button) => { button.disabled = busy || !ready || !writable; });
  $("recommendList").setAttribute("aria-busy", String(busy));
  $("watchFixtureBtn").hidden = watching;
  $("watchLiveBtn").hidden = watching || liveConfirmOpen || Boolean(state?.room && !state.room.liveAllowed);
  $("disconnectRoomBtn").hidden = !watching;
  if (watching) {
    liveConfirmOpen = false;
    $("liveConfirmation").hidden = true;
  }
}
function closeSearch() {
  $("searchPopup").hidden = true;
  $("playerSearch").setAttribute("aria-expanded", "false");
  $("playerSearch").removeAttribute("aria-activedescendant");
  activeIndex = -1;
}
function clearSelection() {
  selected = null;
  $("playerSearch").value = "";
  $("selection").hidden = true;
  $("clearSearch").hidden = true;
  closeSearch();
  updateControls();
}
function playerMeta(player) {
  const ranking = state.source === "fantasypros"
    ? (player.fantasyProsRank == null ? "ECR not matched" : `ECR #${player.fantasyProsRank}`)
    : `SportsLine ${player.sportslineRating}/100`;
  return `${ranking} / ADP ${player.adp == null ? "not supplied" : player.adp.toFixed(1)}`;
}
function selectPlayer(player) {
  selected = player;
  $("playerSearch").value = player.name;
  $("selectedName").textContent = player.name;
  $("selectedMeta").textContent = playerMeta(player);
  $("selectedPosition").textContent = player.position;
  $("selectedPosition").dataset.position = player.position;
  $("selection").hidden = false;
  $("clearSearch").hidden = false;
  closeSearch();
  updateControls();
  $("submitPick").focus();
}
const normalize = (text) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function highlight(index) {
  activeIndex = index;
  [...$("playerResults").children].forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
  const option = $("playerResults").children[index];
  if (option) {
    $("playerSearch").setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  } else $("playerSearch").removeAttribute("aria-activedescendant");
}
function search() {
  if (!state || busy || !ready || !roomWritable()) return;
  const query = normalize($("playerSearch").value);
  const sorted = [...state.availablePlayers].sort((a, b) => state.source === "fantasypros"
    ? (a.fantasyProsRank ?? Infinity) - (b.fantasyProsRank ?? Infinity) || a.name.localeCompare(b.name)
    : (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.name.localeCompare(b.name));
  const allMatches = sorted.filter((p) => !query || normalize(p.name).includes(query));
  matches = allMatches.slice(0, 30);
  $("playerResults").replaceChildren();
  matches.forEach((player, index) => {
    const option = element("li", "player-option");
    option.id = `player-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    const identity = element("div");
    identity.append(element("strong", "", player.name), element("small", "", playerMeta(player)));
    option.append(identity, positionBadge(player.position));
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("click", () => selectPlayer(player));
    $("playerResults").append(option);
  });
  $("searchCaption").textContent = query
    ? `${allMatches.length} match${allMatches.length === 1 ? "" : "es"}${allMatches.length > 30 ? " / showing first 30" : ""}`
    : `Browse available players / ${state.source === "fantasypros" ? "ECR order" : "ADP order"}`;
  $("noResults").hidden = matches.length > 0;
  $("searchPopup").hidden = false;
  $("playerSearch").setAttribute("aria-expanded", "true");
  highlight(-1);
}

function renderState(s) {
  state = s;
  const room = s.room ?? { kind: "manual", status: "disconnected", writable: true, liveAllowed: true, conflicts: [] };
  const copy = roomCopy(room);
  $("leagueName").textContent = s.leagueName;
  $("leagueFormat").textContent = `${s.teamCount} teams / Keeper draft`;
  $("userTeam").textContent = s.userTeamName;
  $("roomLabel").dataset.status = room.status;
  $("roomLabelText").textContent = copy.label;
  $("roomDetail").textContent = copy.detail || "";
  $("roomDetail").hidden = !copy.detail;
  $("sessionNote").textContent = copy.note;
  $("pickEyebrow").textContent = s.waitingToStart ? "Draft starts in" : "Overall pick";
  $("currentPick").textContent = s.waitingToStart ? "—" : String(s.currentOverallPick).padStart(2, "0");
  const clockText = formatClock(s.clockSecondsRemaining, s.clockLabel);
  $("draftClock").textContent = s.waitingToStart && clockText ? `${clockText} until start` : clockText;
  $("draftClock").hidden = !clockText;
  $("draftClockRaw").textContent = s.clockRaw ? `CBS ${s.clockRaw}` : "";
  $("draftClockRaw").hidden = !s.clockRaw;
  $("clockTeam").textContent = s.teamOnClock;
  $("turnLabel").textContent = s.waitingToStart ? "Waiting for start" : s.isUserTurn ? "You're on the clock" : "On the clock";
  document.querySelector(".clock-strip").classList.toggle("your-turn", s.isUserTurn);
  const pickSource = room.writable ? "recorded" : "from the room";
  $("turnContext").textContent = s.waitingToStart
    ? (clockText ? `${clockText} until CBS starts the draft.` : "CBS has not started the draft.")
    : `Round ${s.round} / ${s.draftedCount} pick${s.draftedCount === 1 ? "" : "s"} ${pickSource}`;
  $("pickInterval").textContent = s.pickIntervalLabel
    || (room.status === "watching" ? "CBS is not showing time between picks on this screen." : "");
  $("pickInterval").hidden = !$("pickInterval").textContent;
  const orderSource = s.draftOrderSource === "cbs" ? "CBS draft order" : s.draftOrderSource === "config" ? "Configured draft order" : "Draft order not on this CBS screen";
  $("draftOrderLabel").textContent = orderSource;
  $("draftOrderNote").textContent = s.draftOrderSource === "cbs"
    ? (s.draftOrder?.length < s.teamCount
      ? `CBS team list is showing ${s.draftOrder.length} of ${s.teamCount} teams. The companion clicks the right arrow in that row to collect the rest.`
      : "Read from the CBS team list. Later rounds use that order as a snake.")
    : s.draftOrderSource === "config"
      ? "Used while you record locally. Watch CBS to replace this with the room."
      : "The room is attached, but team names were not in the CBS team-list labels.";
  $("draftOrder").replaceChildren(...(s.draftOrder ?? []).map((team, index) => {
    const isYou = team === s.userTeamName;
    const entry = element("div", `order-team${isYou ? " is-you" : ""}`);
    entry.append(element("strong", "", `${index + 1}`), element("span", "", team));
    return entry;
  }));
  $("nextPick").textContent = s.isUserTurn ? "You're up" : s.nextUserOverallPick == null ? "Not confirmed" : `#${s.nextUserOverallPick}`;
  $("pickDistance").textContent = s.isUserTurn ? (room.writable ? "Choose your player below" : "Watch the room, then pick there") : s.nextUserOverallPick == null ? "Verify late picks in CBS" : `${s.nextUserOverallPick - s.currentOverallPick} picks until your turn`;
  $("recordFor").textContent = room.writable
    ? `Recording #${s.currentOverallPick} for ${s.teamOnClock}.`
    : `Pick #${s.currentOverallPick} is coming from the draft room for ${s.teamOnClock}.`;
  $("recordTitle").textContent = room.writable ? "Who just got picked?" : "The room is updating the board";
  $("roomConflicts").hidden = !room.conflicts?.length;
  $("roomConflicts").textContent = room.conflicts?.length ? room.conflicts.join(" ") : "";
  if (selected && !s.availablePlayers.some((player) => player.id === selected.id)) clearSelection();
  $("availableCount").textContent = `${s.availablePlayers.length} available`;
  $("sourceSelect").value = s.source;
  sourceBeforeChange = s.source;
  $("recommendContext").textContent = s.isUserTurn
    ? `You're up. These suggestions use ${s.userTeamName}'s roster and the current board.`
    : `For ${s.userTeamName}, not the team on the clock. A current-board preview, not a prediction of who will survive.`;
  $("sourceCaveat").textContent = s.source === "fantasypros"
    ? "Experimental FantasyPros mode converts ECR into a synthetic rating and still uses SportsLine ADP. CSV scoring format is unverified. It is not a pure FantasyPros recommendation."
    : "SportsLine ratings are not overall draft ranks. The engine applies your configured strategy on top of those ratings.";
  $("upcomingPicks").replaceChildren(...s.upcomingPicks.map((pick) => {
    const isYou = pick.fantasyTeam === s.userTeamName;
    const entry = element("div", `track-pick${isYou ? " is-you" : ""}`);
    entry.append(element("strong", "", `#${pick.overallPick}${isYou ? " / YOU" : ""}`), element("span", "", pick.fantasyTeam));
    entry.title = `Pick ${pick.overallPick}: ${pick.fantasyTeam}`;
    return entry;
  }));
  $("rosterCount").textContent = `${s.userRoster.length} players`;
  const filled = positions.reduce((n, pos) => n + Math.min(s.lineup[pos], s.userRoster.filter((p) => p.position === pos).length), 0);
  const total = positions.reduce((n, pos) => n + s.lineup[pos], 0);
  $("starterCount").textContent = `${filled}/${total} starters filled`;
  $("rosterList").replaceChildren(...positions.map((position) => {
    const group = element("div", "roster-group");
    const players = s.userRoster.filter((p) => p.position === position);
    const heading = element("div", "roster-group-header");
    heading.append(positionBadge(position), element("span", "", `${players.length} rostered / ${s.lineup[position]} start`));
    group.append(heading);
    for (const player of players) {
      const row = element("div", "roster-player");
      row.append(element("span", "", player.name));
      if (player.source === "keeper") row.append(element("span", "keeper-tag", "Keeper"));
      group.append(row);
    }
    const missing = Math.max(0, s.lineup[position] - players.length);
    if (missing) group.append(element("p", "open-slot", `${missing} open starter slot${missing === 1 ? "" : "s"}`));
    return group;
  }));
  $("keeperCount").textContent = String(s.keepers.length);
  const keeperTeams = [...new Set(s.keepers.map((k) => k.fantasyTeam))];
  $("keepersList").replaceChildren(...keeperTeams.map((team) => {
    const row = element("div", "keeper-team");
    row.append(element("strong", "", team));
    s.keepers.filter((k) => k.fantasyTeam === team).forEach((k) => row.append(element("p", "", `${k.name} (${k.position})`)));
    return row;
  }));
  $("historyCount").textContent = String(s.draftedCount);
  $("historyList").replaceChildren();
  if (!s.picks.length) $("historyList").append(element("p", "empty-state", "A clean board. Record the first pick above to start your draft log."));
  for (const pick of [...s.picks].reverse()) {
    const row = element("div", `history-row${pick.fantasyTeam === s.userTeamName ? " is-you" : ""}`);
    row.append(element("span", "", `#${pick.overallPick}`), element("strong", "", pick.playerName), element("span", "history-team", pick.fantasyTeam), positionBadge(pick.position));
    $("historyList").append(row);
  }
}
function renderRecommendations(data) {
  const container = $("recommendList");
  container.replaceChildren();
  if (!data.recommendations?.length) container.append(element("p", "empty-state", "No eligible suggestions on this board. You can still search and record an available player."));
  for (const rec of data.recommendations || []) {
    const row = element("article", "rec");
    const main = element("div", "rec-main");
    const identity = element("div", "rec-identity");
    if (rec.rank === 1) identity.append(element("span", "eyebrow", "Top engine suggestion"));
    identity.append(element("h3", "", rec.playerName));
    const have = state.userRoster.filter((p) => p.position === rec.position).length;
    const need = have < state.lineup[rec.position] ? `Fills an open ${rec.position} slot` : `${rec.position} depth for your bench`;
    const player = state.availablePlayers.find((p) => p.id === rec.playerId);
    identity.append(element("p", "", `${need}${player ? ` / ${state.source === "fantasypros" ? (player.fantasyProsRank == null ? "ECR unmatched" : `ECR #${player.fantasyProsRank}`) : `SL ${player.sportslineRating}/100`}` : ""}`));
    const score = element("div", "rec-score");
    score.append(element("strong", "", Number(rec.score).toFixed(1)), element("span", "", "Score"));
    const choose = element("button", "select-rec", "Select");
    choose.type = "button";
    choose.setAttribute("aria-label", `Select ${rec.playerName}`);
    choose.addEventListener("click", () => {
      if (player && !busy && ready) { selectPlayer(player); $("pickForm").scrollIntoView({ block: "center", behavior: "instant" }); }
    });
    main.append(element("span", "rec-rank", String(rec.rank).padStart(2, "0")), identity, positionBadge(rec.position), score, choose);
    const details = element("details");
    details.append(element("summary", "", "Why this player?"));
    const notes = element("ul");
    for (const note of rec.notes || []) notes.append(element("li", "", note));
    details.append(notes);
    row.append(main, details);
    container.append(row);
  }
}
function syncPolling() {
  const watching = Boolean(state?.room && !state.room.writable);
  if (watching && !pollTimer) {
    pollTimer = setInterval(() => { if (!busy) refresh().catch(() => {}); }, 1000);
  }
  if (!watching && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
async function refresh() {
  const s = await api("state");
  renderState(s);
  ready = true;
  $("retryBtn").hidden = true;
  const recKey = `${s.source}:${s.currentOverallPick}:${s.draftedCount}:${s.room?.status ?? "disconnected"}`;
  if (recKey !== lastRecKey) {
    lastRecKey = recKey;
    try { renderRecommendations(await api("recommend")); }
    catch (error) {
      $("recommendList").replaceChildren(element("p", "empty-state", `Suggestions unavailable: ${error.message} You can still ${s.room?.writable === false ? "watch the room" : "record picks"}.`));
    }
  }
  updateControls();
  syncPolling();
}
async function mutate(path, body, success) {
  if (busy || !ready) return;
  busy = true;
  closeSearch();
  updateControls();
  let committed = false;
  try {
    const result = await api(path, body);
    committed = true;
    clearSelection();
    await refresh();
    announce(success(result));
    $("resetConfirmation").hidden = true;
    $("resetBtn").hidden = false;
  } catch (error) {
    ready = false;
    $("sourceSelect").value = sourceBeforeChange;
    announce(`${committed ? "Change recorded, but the view could not refresh. " : "Could not confirm the change. "}${error.message} Refresh the board before trying again.`, true);
    $("retryBtn").hidden = false;
  } finally { busy = false; updateControls(); }
}

$("playerSearch").addEventListener("input", () => {
  selected = null;
  $("selection").hidden = true;
  $("clearSearch").hidden = !$("playerSearch").value;
  updateControls();
  search();
});
$("playerSearch").addEventListener("focus", () => { if (!selected) search(); });
$("playerSearch").addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); closeSearch(); }
  if (event.key === "Tab") closeSearch();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if ($("searchPopup").hidden) search();
    if (matches.length) highlight(activeIndex < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1) : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!$("searchPopup").hidden && matches.length) selectPlayer(matches[activeIndex < 0 ? 0 : activeIndex]);
  }
});
document.addEventListener("pointerdown", (event) => { if (!$("searchWrap").contains(event.target)) closeSearch(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest("input, select, textarea, [contenteditable]")) {
    event.preventDefault(); $("playerSearch").focus();
  }
});
$("clearSearch").addEventListener("click", () => { clearSelection(); $("playerSearch").focus(); search(); });
$("pickForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selected || busy) return;
  await mutate("picks", { playerId: selected.id, expectedOverallPick: state.currentOverallPick }, (result) => `Pick #${result.pick.overallPick} recorded: ${result.pick.playerName} to ${result.pick.fantasyTeam}.`);
  if (ready) $("playerSearch").focus();
});
$("undoBtn").addEventListener("click", () => mutate("undo", {}, (result) => result.undone ? `Undid pick #${result.undone.overallPick}: ${result.undone.playerName} is available again.` : "No picks to undo."));
$("sourceSelect").addEventListener("change", () => mutate("source", { source: $("sourceSelect").value }, () => "Ranking source updated. Your recorded picks are unchanged."));
$("resetBtn").addEventListener("click", () => { $("resetConfirmation").hidden = false; $("resetBtn").hidden = true; $("cancelReset").focus(); });
$("cancelReset").addEventListener("click", () => { $("resetConfirmation").hidden = true; $("resetBtn").hidden = false; $("resetBtn").focus(); });
$("confirmReset").addEventListener("click", () => mutate("reset", {}, () => "Draft reset. Keepers are still in place."));
function hideLiveConfirm() {
  liveConfirmOpen = false;
  $("liveConfirmation").hidden = true;
  updateControls();
}
$("watchFixtureBtn").addEventListener("click", () => mutate("room/connect", { source: "fixture" }, () => "Watching the local fake draft room. Picks will appear here automatically."));
$("watchLiveBtn").addEventListener("click", () => {
  liveConfirmOpen = true;
  $("watchLiveBtn").hidden = true;
  $("liveConfirmation").hidden = false;
  $("confirmLive").focus();
});
$("cancelLive").addEventListener("click", () => { hideLiveConfirm(); $("watchLiveBtn").focus(); });
$("confirmLive").addEventListener("click", async () => {
  hideLiveConfirm();
  await mutate("room/connect", { source: "live" }, () => "CBS Chrome is open. Open Draft Room there. This companion stays read-only.");
});
$("disconnectRoomBtn").addEventListener("click", () => mutate("room/disconnect", {}, () => "Disconnected. The last synced board is still here so you can record the rest by hand."));
async function load() {
  if (busy) return;
  busy = true; updateControls();
  try { await refresh(); clearSelection(); announce(""); }
  catch (error) { ready = false; announce(`Cannot load the draft: ${error.message} Check that the companion server is running.`, true); $("retryBtn").hidden = false; }
  finally { busy = false; updateControls(); }
}
$("retryBtn").addEventListener("click", load);
load();
