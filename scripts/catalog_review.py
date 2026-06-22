#!/usr/bin/env python3
"""Generate menu/catalog-review.html — a sortable browse view of the built catalog
(data/restaurants.json) for the curation pass. Active = curation!='hide' and not
CLOSED_*. Run: python3 scripts/catalog_review.py"""
import json, html, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
c = json.load(open(os.path.join(ROOT, "data/restaurants.json")))


def is_closed(r):
    return (r.get("business_status") or "").upper().startswith("CLOSED")


def status_of(r):
    if is_closed(r):
        return "closed"
    if r.get("curation") == "hide":
        return "hidden"
    return "active"


# flag likely duplicate/chain clusters (shared name stem)
stems = collections.defaultdict(list)
for r in c:
    toks = r["id"].split("-")
    stem = toks[0] if toks[0] not in ("the", "le", "la", "cafe", "el") else "-".join(toks[:2])
    stems[stem].append(r["id"])
chain_ids = {i for grp in stems.values() if len(grp) > 1 for i in grp}

rows = []
for r in sorted(c, key=lambda r: (-(r.get("date_night_score") or 0), r["name"])):
    st = status_of(r)
    dns = r.get("date_night_score") or 0
    price = "$" * (r.get("price_tier") or 0)
    ndish = len(r.get("dishes") or [])
    chain = "⛓" if r["id"] in chain_ids else ""
    vibes = ", ".join((r.get("vibe_tags") or [])[:4])
    badge = {"active": "", "closed": "CLOSED", "hidden": "HIDDEN"}[st]
    rows.append(f"""<tr class="{st}" data-dns="{dns}" data-status="{st}">
      <td class="dns d{dns}">{dns or '–'}</td>
      <td class="name">{html.escape(r['name'])} <span class="chain">{chain}</span> <span class="badge">{badge}</span></td>
      <td>{html.escape(r.get('cuisine') or '')}</td>
      <td>{html.escape(r.get('neighborhood') or '')}</td>
      <td>{price}</td>
      <td class="num">{ndish}</td>
      <td>{html.escape(r.get('menu_completeness') or '')}</td>
      <td class="vibes">{html.escape(vibes)}</td>
    </tr>""")

active = sum(1 for r in c if status_of(r) == "active")
closed = sum(1 for r in c if status_of(r) == "closed")
hidden = sum(1 for r in c if status_of(r) == "hidden")
nchain = len([i for i in chain_ids if status_of(next(r for r in c if r['id'] == i)) == 'active'])

doc = f"""<!doctype html><meta charset=utf-8><title>Catalog Review</title>
<style>
 body{{font:14px/1.45 -apple-system,system-ui,sans-serif;margin:0;background:#faf8f5;color:#1a1a1a}}
 header{{padding:20px 28px;background:#fff;border-bottom:1px solid #e7e2da;position:sticky;top:0;z-index:2}}
 h1{{margin:0 0 6px;font-size:20px}} .sub{{color:#666;font-size:13px}}
 .pills{{margin-top:10px}} .pill{{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;margin-right:6px;cursor:pointer;border:1px solid #ddd;background:#fff;user-select:none}}
 .pill.on{{background:#1a1a1a;color:#fff;border-color:#1a1a1a}}
 table{{border-collapse:collapse;width:100%}}
 th,td{{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top}}
 th{{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#888;background:#f4f1ec;position:sticky;top:73px;cursor:pointer}}
 tr.closed{{opacity:.42}} tr.hidden{{opacity:.55;background:#fbfaf8}}
 .dns{{font-weight:700;text-align:center;width:34px}}
 .d5{{color:#1a7f37}} .d4{{color:#2da44e}} .d3{{color:#9a6700}} .d2{{color:#bc4c00}} .d1,.d0{{color:#cf222e}}
 .name{{font-weight:600}} .num{{text-align:center}} .vibes{{color:#666;font-size:13px}}
 .chain{{color:#bc4c00}} .badge{{font-size:10px;color:#cf222e;font-weight:700;letter-spacing:.05em}}
 tr.hidden .badge{{color:#57606a}}
</style>
<header>
 <h1>Dinner for Two — Catalog Review</h1>
 <div class=sub><b>{len(c)}</b> rooms · <b>{active}</b> active (served by retrieval) · {closed} closed-suppressed · {hidden} hidden · <b>{nchain}</b> active rows in ⛓ chain/variant clusters (curation candidates)</div>
 <div class=pills>
  <span class="pill on" data-f="all">All</span>
  <span class="pill" data-f="active">Active only</span>
  <span class="pill" data-f="chains">⛓ Chains/variants</span>
  <span class="pill" data-f="lowdns">dns ≤ 2</span>
  <span class="pill" data-f="closed">Closed</span>
 </div>
</header>
<table id=t>
 <thead><tr><th>DNS</th><th>Name</th><th>Cuisine</th><th>Neighborhood</th><th>$</th><th>Dishes</th><th>Tier</th><th>Vibe</th></tr></thead>
 <tbody>
 {''.join(rows)}
 </tbody>
</table>
<script>
 const rows=[...document.querySelectorAll('#t tbody tr')];
 document.querySelectorAll('.pill').forEach(p=>p.onclick=()=>{{
   document.querySelectorAll('.pill').forEach(x=>x.classList.remove('on'));p.classList.add('on');
   const f=p.dataset.f;
   rows.forEach(r=>{{
     const dns=+r.dataset.dns, st=r.dataset.status, chain=r.querySelector('.chain').textContent.trim();
     let show=true;
     if(f==='active')show=st==='active';
     else if(f==='chains')show=!!chain;
     else if(f==='lowdns')show=dns<=2;
     else if(f==='closed')show=st==='closed';
     r.style.display=show?'':'none';
   }});
 }});
 // click a header to sort
 document.querySelectorAll('th').forEach((th,i)=>th.onclick=()=>{{
   const tb=document.querySelector('tbody'),rs=[...tb.rows];
   rs.sort((a,b)=>{{const x=a.cells[i].textContent.trim(),y=b.cells[i].textContent.trim();
     const nx=parseFloat(x),ny=parseFloat(y);
     return (!isNaN(nx)&&!isNaN(ny))?ny-nx:x.localeCompare(y);}});
   rs.forEach(r=>tb.appendChild(r));
 }});
</script>"""

out = os.path.join(ROOT, "menu/catalog-review.html")
open(out, "w").write(doc)
print(f"wrote {out}: {len(c)} rooms ({active} active, {closed} closed, {nchain} chain-cluster rows)")
