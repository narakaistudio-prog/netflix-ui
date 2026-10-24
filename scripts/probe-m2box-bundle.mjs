const UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const urls=[
 'https://h5-static.aoneroom.com/ssrStatic/m2boxorg/public/_nuxt/DEG2b77B.js',
];
for(const u of urls){
  try{
    const r=await fetch(u,{headers:{'User-Agent':UA}});
    const t=await r.text();
    console.log('==',u,r.status,t.length);
    for(const pat of ['subject/play','X-Play','playMode','streamSignType','sign','mb_auth_token','subject-api','resolutionList','hasResource']){
      let i=t.indexOf(pat); let n=0; const hits=[];
      while(i>-1 && n<3){ hits.push(t.slice(Math.max(0,i-120), i+160).replace(/\s+/g,' ')); i=t.indexOf(pat,i+1); n++; }
      console.log(`-- ${pat} (${hits.length})`);
      hits.forEach(h=>console.log('   ',h.slice(0,280)));
    }
  }catch(e){console.log(u,'fail',String(e.message).slice(0,80));}
}
