import { chromium } from "playwright";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const b=await chromium.launch({headless:true,args:["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"]});
const p=await b.newPage({userAgent:UA,viewport:{width:1280,height:1800}});
await p.goto("https://www.robroyseattle.com/menu",{waitUntil:"domcontentloaded",timeout:45000});
await p.waitForFunction(()=>(document.body?.innerText||"").trim().length>500,{timeout:12000}).catch(()=>{});
try{await p.waitForLoadState("networkidle",{timeout:6000});}catch{}
console.log("after hydrate URL:", p.url());
// reveal-click step (current code)
await p.evaluate(()=>{
  document.querySelectorAll('[aria-expanded="false"], .accordion, summary').forEach(el=>el.click?.());
  const wants=t=>/\b(dinner|food|menu)\b/i.test(t)&&!/wine|drink|brunch|lunch|gift|cater|reserv/i.test(t);
  document.querySelectorAll('button, [role="tab"], [role="button"], [class*="tab"], [class*="nav"] li').forEach(el=>{
    const t=(el.textContent||"").trim();
    if(t.length>0&&t.length<=24&&wants(t)){try{el.click?.();}catch{}}
  });
}).catch(e=>console.log("reveal err",e.message));
await p.waitForTimeout(1200);
console.log("after reveal-click URL:", p.url(), "| imgCount:", await p.evaluate(()=>document.querySelectorAll("img").length));
