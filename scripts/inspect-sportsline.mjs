import XLSX from "xlsx";

const wb = XLSX.readFile("data/reference/cheatsheet_cbsppr12.xlsx");
const POS = ["QB", "RB", "WR", "TE", "K", "DST"];

function norm(name) {
  return name
    .normalize("NFKD")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const players = [];
for (const pos of POS) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[pos], { defval: null });
  for (const row of rows) {
    if (!row.PLAYER) continue;
    const rating = Number(row["OPTIMAL POSITION RATING"]);
    if (!Number.isFinite(rating)) continue;
    const sourceName = String(row.PLAYER);
    const name = norm(sourceName);
    const adp = row.ADP === "" || row.ADP == null ? null : Number(row.ADP);
    players.push({
      sourceName,
      name,
      pos,
      rating,
      adp: Number.isFinite(adp) ? adp : null,
      round: row.ROUND,
      bye: row["BYE WEEK"]
    });
  }
}

const withAdp = players.filter((p) => p.adp != null).sort((a, b) => a.adp - b.adp);
console.log("total", players.length);
console.log("withAdp", withAdp.length);
console.log("DST", JSON.stringify(players.filter((p) => p.pos === "DST").map((p) => p.sourceName)));
console.log("\nTOP 80 BY ADP");
for (const p of withAdp.slice(0, 80)) {
  console.log(`${p.adp.toFixed(2).padStart(7)}  ${String(p.rating).padStart(3)}  ${p.pos.padEnd(3)}  ${p.name}`);
}

const names = ["Ashton Jeanty", "George Pickens", "Kenneth Walker III", "Bijan Robinson", "Josh Allen", "Puka Nacua", "Ja'Marr Chase", "Trey McBride"];
for (const n of names) {
  const hits = players.filter((p) => p.name.toLowerCase() === n.toLowerCase());
  console.log("EXACT", n, JSON.stringify(hits));
}
