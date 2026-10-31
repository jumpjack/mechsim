/* =====================================================================
   core/02-expression.js
   Valutatore delle espressioni del JSON (makeEvaluator) e template()
   ===================================================================== */
function makeEvaluator(M, state, resolving, gTeeth, gModule, gRadius) {
  const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max };
  const cache = {};

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let str = "";
        while (j < src.length) {
          const c = src[j];
          if (c === "\\" && j + 1 < src.length) {
            const nxt = src[j+1];
            if (nxt === quote || nxt === "\\") { str += nxt; j += 2; continue; }
          }
          if (c === quote) break;
          str += c; j++;
        }
        if (j >= src.length) throw new Error('Stringa non chiusa: ' + src);
        tokens.push({type:'string', value:str});
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && i+1 < src.length && /[0-9]/.test(src[i+1]))) {
        const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
        if (m) {
          tokens.push({type:'number', value:parseFloat(m[0])});
          i += m[0].length;
          continue;
        }
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        tokens.push({type:'identifier', name:src.slice(i,j)});
        i = j;
        continue;
      }
      if (',.+-*/^()[]'.indexOf(ch) >= 0) {
        tokens.push({type:'op', value:ch});
        i++;
        continue;
      }
      throw new Error('Carattere inatteso: ' + ch + ' in ' + src);
    }
    return tokens;
  }

  class Parser {
    constructor(tokens){ this.tokens=tokens; this.pos=0; }
    peek(){ return this.tokens[this.pos]; }
    consume(){ return this.tokens[this.pos++]; }
    parseExpression(){ return this.parseAddSub(); }
    parseAddSub(){
      let left=this.parseMulDiv();
      while (this.peek() && this.peek().type==='op' && (this.peek().value==='+'||this.peek().value==='-')){
        const op=this.consume().value;
        const right=this.parseMulDiv();
        left={type:'bin', op, left, right};
      }
      return left;
    }
    parseMulDiv(){
      let left=this.parseUnary();
      while (this.peek() && this.peek().type==='op' && (this.peek().value==='*'||this.peek().value==='/')){
        const op=this.consume().value;
        const right=this.parseUnary();
        left={type:'bin', op, left, right};
      }
      return left;
    }
    parseUnary(){
      const t=this.peek();
      if (t && t.type==='op' && (t.value==='+'||t.value==='-')){
        const op=this.consume().value;
        const operand=this.parseUnary();
        return {type:'unary', op, operand};
      }
      return this.parsePower();
    }
    parsePower(){
      let left=this.parsePostfix();
      const t=this.peek();
      if (t && t.type==='op' && t.value==='^'){
        this.consume();
        const right=this.parseUnary();
        left={type:'bin', op:'^', left, right};
      }
      return left;
    }
    parsePostfix(){
      let node=this.parsePrimary();
      while (true){
        const t=this.peek();
        if (!t) break;
        if (t.type==='op' && t.value==='.'){
          this.consume();
          const id=this.peek();
          if (!id || id.type!=='identifier') throw new Error('Atteso identificatore dopo .');
          this.consume();
          node={type:'member_dot', base:node, prop:id.name};
        } else if (t.type==='op' && t.value==='['){
          this.consume();
          const key=this.parseExpression();
          const closing=this.peek();
          if (!closing || closing.type!=='op' || closing.value!==']') throw new Error('Atteso ]');
          this.consume();
          node={type:'member_bracket', base:node, key};
        } else break;
      }
      return node;
    }
    parsePrimary(){
      const t=this.peek();
      if (!t) throw new Error('Espressione incompleta');
      if (t.type==='number'){ this.consume(); return {type:'number', value:t.value}; }
      if (t.type==='string'){ this.consume(); return {type:'string', value:t.value}; }
      if (t.type==='identifier'){
        const name=t.name;
        this.consume();
        const nxt=this.peek();
        if (nxt && nxt.type==='op' && nxt.value==='('){
          this.consume();
          const args=[];
          if (!(this.peek() && this.peek().type==='op' && this.peek().value===')')){
            while (true){
              args.push(this.parseExpression());
              const sep=this.peek();
              if (sep && sep.type==='op' && sep.value===','){ this.consume(); continue; }
              break;
            }
          }
          const closing=this.peek();
          if (!closing || closing.type!=='op' || closing.value!==')') throw new Error('Atteso )');
          this.consume();
          return {type:'call', name, args};
        }
        return {type:'identifier', name};
      }
      if (t.type==='op' && t.value==='('){
        this.consume();
        const expr=this.parseExpression();
        const closing=this.peek();
        if (!closing || closing.type!=='op' || closing.value!==')') throw new Error('Atteso )');
        this.consume();
        return expr;
      }
      throw new Error('Token inatteso: '+JSON.stringify(t));
    }
  }

  function parse(src){
    if (cache[src]) return cache[src];
    const tokens=tokenize(src);
    const parser=new Parser(tokens);
    const ast=parser.parseExpression();
    if (parser.pos !== tokens.length) throw new Error('Espressione non completa: ' + src);
    cache[src]=ast;
    return ast;
  }

  function evalNode(node, extra){
    switch(node.type){
      case 'number': return node.value;
      case 'string': return node.value;
      case 'identifier': {
        const name=node.name;
        if (name==='gears') return {__type:'gears_proxy'};
        if (name==='axes') return {__type:'axes_proxy'};
        if (name==='pi') return PI;
        if (extra && name in extra) return extra[name];
        if (name in state.params) return state.params[name];
        if (name in M.constVal) return M.constVal[name];
        if (name in MACHINE.consts){
          if (resolving.has(name)) throw new Error('Costante circolare: '+name);
          resolving.add(name);
          try {
            const v = ev(MACHINE.consts[name], extra);
            M.constVal[name]=v;
            return v;
          } finally { resolving.delete(name); }
        }
        throw new Error('Simbolo sconosciuto: '+name);
      }
      case 'member_dot': {
        const base=evalNode(node.base, extra);
        const prop=node.prop;
        if (base && base.__type==='gears_proxy'){
          const g=M.gearBy[prop];
          if (!g) throw new Error('Ingranaggio sconosciuto (o non attivo in questa variante): '+prop);
          return {__type:'gear', id:prop, ref:g};
        }
        if (base && base.__type==='gear'){
          const g=base.ref;
          if (prop==='z') return gTeeth(g);
          if (prop==='m') return gModule(g);
          if (prop==='pr') return gRadius(g);
          if (prop==='d') return 2*gRadius(g);
          throw new Error('Proprietà ingranaggio sconosciuta: '+prop);
        }
        if (base && base.__type==='axes_proxy'){
          const a=M.axisBy[prop];
          if (!a) throw new Error('Asse sconosciuto (o non attivo in questa variante): '+prop);
          return {__type:'axis', id:prop, ref:a};
        }
        if (base && base.__type==='axis'){
          const a=base.ref;
          if (!a.O) throw new NotPlaced(a.id);
          if (prop==='ox') return a.O[0];
          if (prop==='oy') return a.O[1];
          if (prop==='oz') return a.O[2];
if (prop === 'dx') return a.dir[0];
if (prop === 'dy') return a.dir[1];
if (prop === 'dz') return a.dir[2];
          throw new Error('Proprietà asse sconosciuta: '+prop);
        }
        throw new Error('Accesso . non valido');
      }
      case 'member_bracket': {
        const base=evalNode(node.base, extra);
        let keyVal;
        try { keyVal=evalNode(node.key, extra); }
        catch(e){
          if (node.key.type==='identifier') keyVal=node.key.name;
          else throw e;
        }
        const keyStr = typeof keyVal==='string' ? keyVal : String(keyVal);
        if (base && base.__type==='gears_proxy'){
          const g=M.gearBy[keyStr];
          if (!g) throw new Error('Ingranaggio sconosciuto (o non attivo in questa variante): '+keyStr);
          return {__type:'gear', id:keyStr, ref:g};
        }
        if (base && base.__type==='axes_proxy'){
          const a=M.axisBy[keyStr];
          if (!a) throw new Error('Asse sconosciuto (o non attivo in questa variante): '+keyStr);
          return {__type:'axis', id:keyStr, ref:a};
        }
        if (base && base.__type==='gear'){
          const g=base.ref;
          if (keyStr==='z') return gTeeth(g);
          if (keyStr==='m') return gModule(g);
          if (keyStr==='pr') return gRadius(g);
          if (keyStr==='d') return 2*gRadius(g);
          throw new Error('Proprietà ingranaggio sconosciuta: '+keyStr);
        }
        if (base && base.__type==='axis'){
          const a=base.ref;
          if (!a.O) throw new NotPlaced(a.id);
          if (keyStr==='ox') return a.O[0];
          if (keyStr==='oy') return a.O[1];
          if (keyStr==='oz') return a.O[2];
if (keyStr === 'dx') return a.dir[0];
if (keyStr === 'dy') return a.dir[1];
if (keyStr === 'dz') return a.dir[2];
          throw new Error('Proprietà asse sconosciuta: '+keyStr);
        }
        throw new Error('Accesso [] non valido');
      }
      case 'bin': {
        const l=evalNode(node.left, extra);
        const r=evalNode(node.right, extra);
        switch(node.op){
          case '+': return l+r;
          case '-': return l-r;
          case '*': return l*r;
          case '/': return l/r;
          case '^': return Math.pow(l,r);
          default: throw new Error('Operatore sconosciuto: '+node.op);
        }
      }
      case 'unary': {
        const v=evalNode(node.operand, extra);
        return node.op==='+' ? +v : -v;
      }
      case 'call': {
        const fn=FN[node.name];
        if (!fn) throw new Error('Funzione sconosciuta: '+node.name);
        const args=node.args.map(a=>evalNode(a, extra));
        return fn(...args);
      }
      default: throw new Error('Nodo sconosciuto');
    }
  }

  // Valuta un numero o un'espressione. Gli errori vengono arricchiti con l'espressione e con il contesto (CTX.where).
  function ev(e, extra){
    if (typeof e==='number') return e;
    if (typeof e!=='string') throw new Error('valore non valido (atteso un numero o un\'espressione tra virgolette): ' + JSON.stringify(e) + (CTX.where ? '  [' + CTX.where + ']' : ''));
    try { return evalNode(parse(e), extra); }
    catch (err) {
      if (err instanceof NotPlaced) throw err;
      if (!err.__ctx) { err.message += `  ⟵ espressione "${e}"` + (CTX.where ? `  [${CTX.where}]` : ''); err.__ctx = true; }
      throw err;
    }
  }
  return ev;
}

function template(str, ev, extra) {
  return str.replace(/\{([^{}|]+)(?:\|(\d+))?\}/g, (_, e, d) => fmt(ev(e, extra), d === undefined ? 1 : +d));
}
