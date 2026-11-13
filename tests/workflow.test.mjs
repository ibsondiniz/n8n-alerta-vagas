// Tests read the Code nodes straight from the exported workflow, so the JSON stays the single source of truth.
// All job data below is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../n8n/alerta-vagas.json', import.meta.url), 'utf8'));
const node = name => wf.nodes.find(n => n.name === name);

// Minimal stand-ins for the n8n Code node globals: $input and $('Other node')
function run(name, input = [], others = {}) {
  const $input = { all: () => input.map(json => ({ json })) };
  const $ = other => ({ first: () => ({ json: others[other] }) });
  return new Function('$input', '$', node(name).parameters.jsCode)($input, $).map(i => i.json);
}

const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
const gupy = (id, extra) => ({
  id, name: `Vaga ${id}`, careerPageName: 'Exemplo SA', description: 'Descrição da vaga.',
  workplaceType: 'remote', city: '', state: '', publishedDate: hoursAgo(1), jobUrl: `https://exemplo.gupy.io/job/${id}`, ...extra,
});
const config = { terms: ['python'], remote: true, cities: ['Mossoró'], maxAgeHours: 24, limit: 100 };

test('every connection points to an existing node and the chain has no gaps', () => {
  const names = new Set(wf.nodes.map(n => n.name));
  const targets = new Set();
  for (const [from, { main }] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from);
    for (const c of main.flat()) {
      assert.ok(names.has(c.node), c.node);
      targets.add(c.node);
    }
  }
  const working = wf.nodes.filter(n => !n.type.endsWith('stickyNote') && !n.type.endsWith('Trigger'));
  for (const n of working) assert.ok(targets.has(n.name), `${n.name} has no input`);
});

test('runs every day at 8h in the Mossoró time zone', () => {
  assert.equal(node('Todo dia às 8h').parameters.rule.interval[0].expression, '0 8 * * *');
  assert.equal(wf.settings.timezone, 'America/Fortaleza');
});

test('workflow file holds no secrets or real e-mail addresses', () => {
  const raw = JSON.stringify(wf);
  assert.doesNotMatch(raw, /password|senha"\s*:|apikey|token/i);
  assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.(com|br)/);
  assert.deepEqual(Object.keys(node('Enviar resumo por e-mail').credentials.smtp).sort(), ['id', 'name']);
});

test('builds one Gupy search per term and place', () => {
  const out = run('Definir buscas');
  assert.equal(out.length, 4 * 2);
  assert.ok(out.some(o => o.url.includes('jobName=desenvolvedor%20j%C3%BAnior') && o.url.endsWith('workplaceType=remote')));
  assert.ok(out.some(o => o.url.endsWith('city=Mossor%C3%B3')));
});

test('keeps recent remote jobs and jobs in Mossoró, once each', () => {
  const page1 = { data: [gupy(1), gupy(2, { workplaceType: 'on-site', city: 'Mossoró', state: 'Rio Grande do Norte' })] };
  const page2 = {
    data: [
      gupy(1),                                                    // repeated across searches
      gupy(3, { workplaceType: 'hybrid', city: 'Natal' }),        // other city, not remote
      gupy(4, { publishedDate: hoursAgo(30) }),                   // older than 24 h
      gupy(5, { workplaceType: 'on-site', city: 'mossoro' }),     // accents and case do not matter
    ],
  };
  const [out] = run('Filtrar vagas novas', [page1, page2], { 'Definir buscas': { config } });
  assert.deepEqual(out.jobs.map(j => j.id), ['1', '2', '5']);
  assert.equal(out.jobs[1].place, 'Mossoró/Rio Grande do Norte');
  assert.deepEqual(Object.keys(out.payload.jobs[0]), ['id', 'title', 'text']);
  assert.match(out.payload.jobs[0].text, /^Empresa: Exemplo SA Vaga 1/);
});

test('stops without e-mail when nothing new shows up', () => {
  const old = { data: [gupy(9, { publishedDate: hoursAgo(48) })] };
  assert.deepEqual(run('Filtrar vagas novas', [old], { 'Definir buscas': { config } }), []);
});

test('summary lists good jobs, flags warnings and counts dropped ones', () => {
  const jobs = [
    { id: '1', title: 'Dev Python', company: 'Exemplo SA', place: 'Remoto', url: 'https://exemplo.gupy.io/job/1' },
    { id: '2', title: 'Analista <script>', company: 'Outra & Cia', place: 'Remoto', url: 'javascript:alert(1)' },
    { id: '3', title: 'Digitador', company: 'Golpe Ltda', place: 'Remoto', url: 'https://exemplo.gupy.io/job/3' },
  ];
  const results = [
    { id: '1', verdict: 'ok', signals: [] },
    { id: '2', verdict: 'ALERTA', signals: [{ code: 'A4', meaning: 'descrição curta demais' }] },
    { id: '3', verdict: 'SUSPEITA', signals: [{ code: 'G1', meaning: 'cobra curso' }, { code: 'G2', meaning: 'contato' }] },
  ];
  const [out] = run('Montar resumo', results, { 'Filtrar vagas novas': { jobs } });
  assert.equal(out.subject, 'Alerta de vagas: 2 nova(s)');
  assert.match(out.html, /<a href="https:\/\/exemplo.gupy.io\/job\/1">Dev Python<\/a>/);
  assert.match(out.html, /Analista &lt;script&gt;/);           // job text is escaped
  assert.match(out.html, /<a href="#">/);                      // non-https link neutralized
  assert.match(out.html, /Atenção:<\/b> descrição curta demais/);
  assert.match(out.html, /1 descartada\(s\).*Digitador · Golpe Ltda: SUSPEITA \(G1, G2\)/s);
});
