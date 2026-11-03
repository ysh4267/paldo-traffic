// 아주 작은 가상 DOM. 패널을 자주 갱신해도 버튼이 교체되지 않아 클릭이 끊기지 않는다.
import { iconHtml } from '../render/art.js';

export function h(tag, props, ...kids) {
  return { tag, props: props || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== '') };
}

export function ico(name, cls = '') {
  return h('span', { class: `ico ${cls}`.trim(), html: iconHtml(name), 'aria-hidden': 'true' });
}

export function raw(html, cls = 'ico') {
  return h('span', { class: cls, html, 'aria-hidden': 'true' });
}

function create(v) {
  const el = document.createElement(v.tag);
  el.__key = v.props.key;
  el.__p = {};
  update(el, v);
  return el;
}

function update(el, v) {
  const prev = el.__p;
  const next = v.props;
  for (const k in next) {
    if (k === 'key') continue;
    const val = next[k];
    if (k.startsWith('on')) { el[k] = val; continue; }
    if (prev[k] === val) continue;
    if (k === 'html') { el.innerHTML = val; continue; }
    if (k === 'value') { if (el.value !== String(val)) el.value = val; continue; }
    if (k === 'disabled' || k === 'checked') { el[k] = !!val; continue; }
    if (val === false || val === null || val === undefined) el.removeAttribute(k);
    else el.setAttribute(k, val === true ? '' : val);
  }
  for (const k in prev) {
    if (k in next || k === 'key') continue;
    if (k.startsWith('on')) el[k] = null;
    else if (k === 'html') el.innerHTML = '';
    else el.removeAttribute(k);
  }
  el.__p = next;
  if (next.html === undefined) patch(el, v.kids);
}

export function patch(parent, vnodes) {
  const list = Array.isArray(vnodes) ? vnodes : [vnodes];
  let i = 0;
  for (; i < list.length; i++) {
    const v = list[i];
    const cur = parent.childNodes[i];
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v);
      if (cur && cur.nodeType === 3) { if (cur.nodeValue !== s) cur.nodeValue = s; }
      else {
        const t = document.createTextNode(s);
        if (cur) parent.replaceChild(t, cur); else parent.appendChild(t);
      }
      continue;
    }
    if (cur && cur.nodeType === 1 && cur.localName === v.tag && cur.__key === v.props.key) update(cur, v);
    else {
      const el = create(v);
      if (cur) parent.replaceChild(el, cur); else parent.appendChild(el);
    }
  }
  while (parent.childNodes.length > i) parent.removeChild(parent.lastChild);
}
