// สร้างไฟล์ทดลองใช้ preview/preview.html (ไม่ต้อง deploy)
// รัน: node tools/build-preview.js
// จำลอง Google Sheet ไว้ใน localStorage ของเบราว์เซอร์ — ใช้ทดลองเท่านั้น
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const mock = `<script>
(function(){
  const KEY='preview_db_v4';
  let db={}; try{ db=JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){}
  db.sheets=db.sheets||{}; db.props=db.props||{}; db.cache=db.cache||{};
  const save=()=>{ try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} };
  function Sheet(n){ this.n=n; if(!db.sheets[n]) db.sheets[n]={rows:[],max:1000}; this.d=db.sheets[n]; }
  Sheet.prototype={
    getMaxRows(){return this.d.max}, insertRowsAfter(a,n){this.d.max+=n},
    getLastRow(){let l=0;this.d.rows.forEach((r,i)=>{if(r&&r.some(v=>v!==''&&v!=null))l=i+1});return l},
    setFrozenRows(){}, deleteRow(r){this.d.rows.splice(r-1,1)},
    getRange(r,c,nr,nc){nr=nr||1;nc=nc||1;const s=this.d;const o={
      clearContent(){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){if(s.rows[r-1+i])s.rows[r-1+i][c-1+j]='';}return o},setNumberFormat(){return o},setNumberFormats(){return o},setFontWeight(){return o},setBackground(){return o},setFontColor(){return o},
      setValues(v){v.forEach((row,i)=>{s.rows[r-1+i]=s.rows[r-1+i]||[];row.forEach((x,j)=>{s.rows[r-1+i][c-1+j]=x;});});return o},
      getValues(){const out=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const x=(s.rows[r-1+i]||[])[c-1+j];row.push(x==null?'':x);}out.push(row);}return out}};return o}
  };
  window.SpreadsheetApp={openById:()=>({getSheetByName:n=>db.sheets[n]?new Sheet(n):null,insertSheet:n=>new Sheet(n),getUrl:()=>'#'}),flush(){}};
  window.PropertiesService={getScriptProperties:()=>({getProperty:k=>db.props[k]||null,setProperty:(k,v)=>{db.props[k]=v;}})};
  window.CacheService={getScriptCache:()=>({get:k=>db.cache[k]==null?null:db.cache[k],put:(k,v)=>{db.cache[k]=v;},remove:k=>{delete db.cache[k];}})};
  window.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  window.Logger={log(){}};
  const uuid=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
  function digest(str){ // แฮชจำลองสำหรับ preview เท่านั้น (ของจริงใช้ SHA-256 ของ Google)
    const out=[];let h=2166136261;for(let k=0;k<32;k++){for(let i=0;i<str.length;i++){h^=str.charCodeAt(i)+k;h=Math.imul(h,16777619);}out.push(((h>>>((k%4)*8))&255)-128);}return out; }
  window.Utilities={getUuid:uuid,DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(a,s)=>digest(String(s)),
    formatDate:(d,tz,f)=>{const iso=new Date(d.getTime()+7*3600e3).toISOString();return f==='yyyy-MM-dd'?iso.slice(0,10):iso.slice(0,19).replace('T',' ');}};
  window.HtmlService={};
  window.__previewSave=save;
  window.__previewReset=()=>{ try{localStorage.removeItem(KEY);}catch(e){} location.reload(); };
})();
</script>
<script>
${read('Code.gs')}
</script>
<script>
(function(){
  // ติดตั้ง + ข้อมูลตัวอย่างเดือนนี้
  ensureSetup_(false);
  if (readAll_('Bills').length===0) {
    const T=today_(), month=T.slice(0,7), day=Number(T.slice(8));
    const cats=readAll_('Categories'); const byName=n=>cats.find(c=>c.name===n).id;
    let seed=7; const rnd=(a,b)=>{seed=(seed*9301+49297)%233280;return Math.round((a+seed/233280*(b-a))/10)*10;};
    const tables=['26','22','36','43','31','23','21','35','VIP','46','42','39','29','27','14','20','40','19','2','34'];
    for(let d=1; d<day; d++){
      const date=month+'-'+('0'+d).slice(-2); const n=8+rnd(0,140)/10;
      let fSum=0,dSum=0,disc=0;
      for(let i=0;i<n;i++){ const food=rnd(200,2500), drink=rnd(300,4500), concert=(d%5===0&&i<3)?1500:0, discount=i===2?rnd(0,100):0;
        fSum+=food; dSum+=drink; disc+=discount;
        insert_('Bills',{id:uid_(),date,tableNo:tables[(d*3+i)%tables.length],amount:food+drink,food:0,drink:0,concert,discount,
          total:food+drink+concert-discount,payment:i%3===0?'เงินสด':'โอน',note:'',createdBy:'admin',createdAt:date+' 20:0'+(i%10)+':00',updatedAt:''}); }
      // สรุปรายวัน (เว้น 2 วันล่าสุดไว้ให้ลองสรุปเอง)
      if(d<day-2) insert_('DaySummary',{id:date,date,food:fSum,drink:dSum,discount:disc,carryOverride:'',note:'',updatedBy:'admin',updatedAt:date+' 23:59:00'});
      const exp=(name,amount,pay)=>insert_('Expenses',{id:uid_(),date,categoryId:byName(name),item:name,amount,payment:pay,note:'',createdBy:'admin',createdAt:date+' 18:00:00',updatedAt:''});
      exp('ซื้อของสด',rnd(5000,11000),'โอน'); exp('เครื่องดื่ม',rnd(14000,26000),'โอน'); exp('น้ำแข็ง',rnd(300,700),'โอน');
      exp('ค่าแรง',300,'เงินสด'); if(d%2) exp('ค่านักดนตรี',1500,'เงินสด'); if(d%4===0) exp('ข้าวสาร',1650,'โอน');
    }
    const EMPS=[['กัน','ครัว','daily',583,'กสิกรไทย','0498964794'],['ทน','ทอด','daily',483,'TTB','0954305918'],['แจน','ครัว','daily',483,'TTB','4882258580'],['อัน','ครัว','daily',383,'กสิกรไทย','0473274355'],['ต้อย','ครัว','daily',383,'',''],['โอ','เสิร์ฟ','daily',350,'กรุงไทย','9930100810'],['หัวหน้าร้าน','ผจก.','monthly',15000,'SCB','1660883908']];
    const empIds=EMPS.map(e=>{const id=uid_();insert_('Employees',{id,name:e[0],nickname:'',position:e[1],payType:e[2],rate:e[3],bank:e[4],accountNo:e[5],phone:'',startDate:'',active:true,note:''});return id;});
    insert_('Payroll',{id:uid_(),date:month+'-05',employeeId:empIds[0],employeeName:'กัน',type:'เบิกล่วงหน้า',amount:2500,payment:'เงินสด',note:'',createdBy:'admin',createdAt:month+'-05 12:00:00'});
    insert_('Payroll',{id:uid_(),date:month+'-08',employeeId:empIds[3],employeeName:'อัน',type:'เบิกล่วงหน้า',amount:2000,payment:'เงินสด',note:'',createdBy:'admin',createdAt:month+'-08 12:00:00'});
    insert_('IncomeTypes',{id:'inc_vip',name:'ค่าห้อง VIP',color:'#e0874f',sort:1,active:true});
    insert_('IncomeTypes',{id:'inc_other',name:'ค่าอื่น ๆ',color:'#6fb3a8',sort:2,active:true});
    createUser_({username:'staff',displayName:'พนักงานหน้าร้าน',role:'staff',active:true,password:'staff1234'});
    window.__previewSave();
  }
  // จำลอง google.script.run
  function runner(ok,fail){ return new Proxy({}, { get(t,name){
    if(name==='withSuccessHandler') return f=>runner(f,fail);
    if(name==='withFailureHandler') return f=>runner(ok,f);
    return (...args)=>setTimeout(()=>{ try{ const r=window[name](...args); window.__previewSave(); ok&&ok(r); }catch(e){ fail&&fail(e); } }, 250);
  }}); }
  window.google={script:{run:runner(null,null)}};
})();
</script>
<div style="position:fixed;right:12px;bottom:80px;z-index:100;background:#fff7e6;border:1px solid #f0d49b;color:#8a6a1f;border-radius:12px;padding:8px 12px;font:13px Prompt,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.08)">
  โหมดทดลอง · admin/admin1234 · staff/staff1234 · <a href="#" onclick="__previewReset();return false" style="color:#8a6a1f">รีเซ็ตข้อมูล</a>
</div>`;

let html = read('Index.html')
  .replace("<?!= include('Stylesheet'); ?>", () => read('Stylesheet.html'))
  .replace("<?!= include('JavaScript'); ?>", () => mock + '\n' + read('JavaScript.html'));
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'preview.html'), html);
console.log('สร้าง preview/preview.html แล้ว');
