// SherlockMate — Background Service Worker
// Handles ONLY: encrypted API key storage + Groq API calls
// Stockfish runs inside the content script as a Web Worker

const SK = 'sm_k', SS = 'sm_s', SV = 'sm_iv';
const PEPPER = 'SherlockMate-groq-2024';

async function deriveKey(salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(PEPPER), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

function toB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function fromB64(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}

async function encryptKey(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const aes  = await deriveKey(salt);
  const enc  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(plain));
  await chrome.storage.local.set({ [SK]: toB64(enc), [SS]: toB64(salt.buffer), [SV]: toB64(iv.buffer) });
}

async function decryptKey() {
  const r = await chrome.storage.local.get([SK, SS, SV]);
  if (!r[SK]) return null;
  try {
    const aes = await deriveKey(new Uint8Array(fromB64(r[SS])));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromB64(r[SV])) }, aes, fromB64(r[SK])
    );
    return new TextDecoder().decode(dec);
  } catch { return null; }
}

async function callGroq(fen, moves, apiKey) {
  const list = moves.map((m, i) => `${i+1}. ${m.uci} (eval: ${m.score})`).join('\n');
  console.log('[SM-BG] Calling Groq API with moves:', list);
  const res  = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:    'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content:
        `Chess position FEN: ${fen}\n\nFor each move write 1 sentence (max 10 words) on why it is good.\nOutput ONLY 3 numbered lines 1. 2. 3. No intro.\n\n${list}`
      }],
      max_tokens: 160, temperature: 0.3
    })
  });
  if(!res.ok)throw new Error(`Groq API HTTP ${res.status}`);
  const data = await res.json();
  console.log('[SM-BG] Groq response:', data);
  const text = data.choices?.[0]?.message?.content || '';
  return text.split('\n')
    .filter(l => /^\d\./.test(l.trim()))
    .map(l => l.replace(/^\d\.\s*/, '').trim());
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'SAVE_KEY':
        try { await encryptKey(msg.key); reply({ ok: true }); }
        catch   { reply({ ok: false }); }
        break;
      case 'HAS_KEY': {
        const r = await chrome.storage.local.get(SK);
        reply({ exists: !!r[SK] });
        break;
      }
      case 'MASKED_KEY': {
        const k = await decryptKey();
        reply({ masked: k ? k.slice(0,8) + '•'.repeat(Math.max(0, k.length-8)) : null });
        break;
      }
      case 'CLEAR_KEY':
        await chrome.storage.local.remove([SK, SS, SV]);
        reply({ ok: true });
        break;
      case 'EXPLAIN': {
        const key = await decryptKey();
        if (!key) { reply({ explanations: [] }); break; }
        try {
          reply({ explanations: await callGroq(msg.fen, msg.moves, key) });
        } catch { reply({ explanations: [] }); }
        break;
      }
    }
  })();
  return true;
});
