/** Validate bounded JSON without converting numeric literals into JS numbers. */
export function literalArguments(value:unknown):string {
 if(typeof value!=='string'||new TextEncoder().encode(value).length>16000)throw Error('Invalid tool arguments.');
 const source=value;let cursor=0,nodes=0;
 const fail=():never=>{throw Error('The literal tool arguments could not be verified.');};
 const string=():string=>{
  const start=cursor;if(source[cursor++]!=='"')fail();
  while(cursor<source.length){
   const character=source[cursor++];
   if(character==='"'){
    const decoded:unknown=JSON.parse(source.slice(start,cursor));
    if(typeof decoded!=='string'||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(decoded))return fail();
    return decoded;
   }
   if(character==='\\')cursor++;
  }
  return fail();
 };
 const visit=(depth:number):void=>{
  if(depth>32||++nodes>20000)fail();
  const first=source[cursor];
  if(first==='"'){string();return;}
  if(first==='{'||first==='['){
   cursor++;const closing=first==='{'?'}':']',keys=new Set<string>();
   if(source[cursor]===closing){cursor++;return;}
   for(;;){
    if(first==='{'){
     const key=string();if(++nodes>20000||keys.has(key)||source[cursor++]!==':')fail();keys.add(key);
    }
    visit(depth+1);
    if(source[cursor]===closing){cursor++;return;}
    if(source[cursor++]!==',')fail();
   }
  }
  for(const token of ['null','true','false'])if(source.startsWith(token,cursor)){cursor+=token.length;return;}
  const number=source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
  if(!number)return fail();const token=number[0];cursor+=token.length;
  if(/[.eE]/.test(token)){if(!Number.isFinite(Number(token)))fail();}
  else {const integer=BigInt(token);if(integer<=-(1n<<256n)||integer>=(1n<<256n))fail();}
 };
 if(source[0]!=='{')fail();visit(0);if(cursor!==source.length)fail();return source;
}
