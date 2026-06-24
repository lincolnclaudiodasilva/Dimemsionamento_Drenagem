import React, { useState, useMemo, useRef } from "react";
import { Plus, Trash2, ChevronDown, FileDown, Droplets, Waves, CircleDot, AlertTriangle, CheckCircle2, Save, FolderOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// CONSTANTES E HELPERS DE CÁLCULO
// ---------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10);

const fmt = (n, dec = 2) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

const num = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Método Racional: Q (m3/s) = C * I(mm/h) * A(ha) / 360
function calcQ({ C, I, A }) {
  if (C === null || I === null || A === null) return null;
  return (C * I * A) / 360;
}

// Manning para canal trapezoidal: Q = (1/n) * A_mol * R^(2/3) * S^(1/2)
// Resolvido por busca (dado b, m, S, n -> encontra altura y que atende Q)
function trapezoidalGeometry(y, b, m) {
  const area = (b + m * y) * y;
  const perimeter = b + 2 * y * Math.sqrt(1 + m * m);
  const Rh = perimeter > 0 ? area / perimeter : 0;
  const topWidth = b + 2 * m * y;
  return { area, perimeter, Rh, topWidth };
}

function manningQ(y, b, m, n, S) {
  const { area, Rh } = trapezoidalGeometry(y, b, m);
  if (Rh <= 0 || area <= 0) return 0;
  return (1 / n) * area * Math.pow(Rh, 2 / 3) * Math.sqrt(S);
}

// Busca binária da altura de lâmina d'água que atende a vazão de projeto
function solveChannelDepth({ Q, b, m, n, S }) {
  if ([Q, b, m, n, S].some((v) => v === null) || Q <= 0 || n <= 0 || S <= 0) return null;
  let lo = 0.001;
  let hi = 20;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const qMid = manningQ(mid, b, m, n, S);
    if (qMid < Q) lo = mid;
    else hi = mid;
  }
  const y = (lo + hi) / 2;
  const geo = trapezoidalGeometry(y, b, m);
  const v = geo.area > 0 ? manningQ(y, b, m, n, S) / geo.area : 0;
  return { y, v, ...geo };
}

// Tubo circular parcialmente cheio — geometria por ângulo central theta (rad)
function circularGeometry(theta, D) {
  const r = D / 2;
  const area = (r * r) * (theta - Math.sin(theta)) / 2;
  const perimeter = r * theta;
  const Rh = perimeter > 0 ? area / perimeter : 0;
  const y = r * (1 - Math.cos(theta / 2));
  return { area, perimeter, Rh, y };
}

function pipeQatTheta(theta, D, n, S) {
  const { area, Rh } = circularGeometry(theta, D);
  if (Rh <= 0 || area <= 0) return 0;
  return (1 / n) * area * Math.pow(Rh, 2 / 3) * Math.sqrt(S);
}

// Vazão máxima de um tubo circular (ocorre a ~91,38% do diâmetro, theta ~ 5.348 rad)
function pipeMaxQ(D, n, S) {
  let best = 0;
  for (let i = 1; i < 400; i++) {
    const theta = (i / 400) * 2 * Math.PI;
    const q = pipeQatTheta(theta, D, n, S);
    if (q > best) best = q;
  }
  return best;
}

// Diâmetros comerciais PEAD corrugado (mm) — referência de catálogo, ajustável
const COMMERCIAL_DIAMETERS_MM = [300, 400, 500, 600, 700, 800, 1000, 1200, 1500, 1800, 2000];

function chooseCommercialPipe({ Q, n, S, fillRatio }) {
  if ([Q, n, S].some((v) => v === null) || Q <= 0 || n <= 0 || S <= 0) return null;
  for (const dmm of COMMERCIAL_DIAMETERS_MM) {
    const D = dmm / 1000;
    const qMax = pipeMaxQ(D, n, S);
    const qAdm = qMax * (fillRatio ?? 1); // aplica fator de segurança de enchimento se desejado
    if (qAdm >= Q) {
      // calcula altura de lâmina para essa vazão neste diâmetro
      let lo = 0.001, hi = Math.PI * 2 - 0.001;
      for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        const q = pipeQatTheta(mid, D, n, S);
        if (q < Q) lo = mid; else hi = mid;
      }
      const theta = (lo + hi) / 2;
      const geo = circularGeometry(theta, D);
      const fillPct = (geo.y / D) * 100;
      return { D, dmm, qMax, fillPct, y: geo.y, v: geo.area > 0 ? Q / geo.area : 0 };
    }
  }
  return { D: null, dmm: null, qMax: null, overflow: true };
}

// Volume mínimo de bacia (regra prática 134 yd3/acre ≈ 93.7 m3/ha) + checagem por hidrograma simplificado
const YD3_PER_ACRE_TO_M3_PER_HA = 93.7; // 134 yd3/acre convertido

function calcBasinVolume({ A_ha, C, I, TR_factor, Q, peakRatio }) {
  if (A_ha === null) return null;
  const volSediment = A_ha * YD3_PER_ACRE_TO_M3_PER_HA;
  // Volume de amortecimento simplificado: fração do volume gerado pela chuva de projeto
  // V_chuva (m3) = Q (m3/s) * duração efetiva (s) -- aproximação triangular do hidrograma
  let volDetention = null;
  if (Q !== null && peakRatio !== null) {
    const durationSec = (peakRatio ?? 1) * 3600; // duração equivalente em horas -> segundos
    volDetention = 0.5 * Q * durationSec; // hidrograma triangular simplificado
  }
  return { volSediment, volDetention };
}

// ---------------------------------------------------------------------------
// DADOS PADRÃO DE UMA REGIÃO
// ---------------------------------------------------------------------------

function emptyRegion(name = "") {
  return {
    id: uid(),
    name,
    notes: "",
    // Hidrologia comum
    hydro: {
      A_ha: "",     // área de drenagem (ha)
      C: "",        // coeficiente de escoamento (runoff) -- usuário define
      I: "",        // intensidade pluviométrica mm/h -- usuário define
      TR: "",       // tempo de retorno (anos) -- usuário define, apenas registro
      durationH: "1", // duração equivalente p/ volume de amortecimento (h)
    },
    // Bacia
    basin: {
      enabled: true,
      grainSize: "",       // descrição granulometria
      freeboard: "0.5",    // borda livre m
      sideSlope: "2",      // H:1V
    },
    // Canal
    channel: {
      enabled: true,
      n: "",          // Manning -- usuário define
      S: "",          // declividade m/m
      b: "0.5",       // largura de fundo m
      m: "1.5",       // talude lateral (H:V)
      freeboard: "0.2",
      lining: "",     // tipo de revestimento (texto)
    },
    // Tubo
    pipe: {
      enabled: true,
      n: "",          // Manning -- usuário define
      S: "",          // declividade m/m
      fillRatio: "0.85", // fator de segurança sobre vazão máx (enchimento admissível)
      cover: "",      // recobrimento/carga (texto)
    },
  };
}

// ---------------------------------------------------------------------------
// COMPONENTES DE UI
// ---------------------------------------------------------------------------

function Field({ label, hint, unit, value, onChange, placeholder, type = "text", userDefined = false, width }) {
  return (
    <label className={`field ${width ? "" : "field--auto"}`} style={width ? { flex: `0 0 ${width}` } : undefined}>
      <span className="field__label">
        {label}
        {userDefined && <span className="field__badge">definir</span>}
      </span>
      <div className="field__inputwrap">
        <input
          className="field__input"
          type={type}
          inputMode={type === "text" ? undefined : "decimal"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className="field__unit">{unit}</span>}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function ResultRow({ label, value, unit, formula, emphasis }) {
  return (
    <div className={`resultrow ${emphasis ? "resultrow--main" : ""}`}>
      <div className="resultrow__top">
        <span className="resultrow__label">{label}</span>
        <span className="resultrow__value">
          {value}
          {unit && <span className="resultrow__unit">{unit}</span>}
        </span>
      </div>
      {formula && <span className="resultrow__formula">{formula}</span>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, open, onToggle, accent }) {
  return (
    <button className="sectionhead" onClick={onToggle} style={{ "--accent": accent }}>
      <span className="sectionhead__icon"><Icon size={18} strokeWidth={2} /></span>
      <span className="sectionhead__text">
        <span className="sectionhead__title">{title}</span>
        <span className="sectionhead__subtitle">{subtitle}</span>
      </span>
      <ChevronDown size={18} className={`sectionhead__chev ${open ? "sectionhead__chev--open" : ""}`} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// APP PRINCIPAL
// ---------------------------------------------------------------------------

const PROJECT_FILE_VERSION = 1;

export default function DrainageApp() {
  const [regions, setRegions] = useState([emptyRegion("Frente Norte")]);
  const [activeId, setActiveId] = useState(regions[0].id);
  const [openSections, setOpenSections] = useState({ basin: true, channel: true, pipe: true });
  const [showReport, setShowReport] = useState(false);
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [importError, setImportError] = useState("");
  const reportRef = useRef(null);
  const fileInputRef = useRef(null);

  const active = regions.find((r) => r.id === activeId) || regions[0];

  // Qualquer alteração de dados marca o projeto como "não salvo"
  function markDirty() {
    setDirty(true);
  }

  function updateRegion(id, patch) {
    setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markDirty();
  }
  function updateField(id, group, key, value) {
    setRegions((rs) =>
      rs.map((r) => (r.id === id ? { ...r, [group]: { ...r[group], [key]: value } } : r))
    );
    markDirty();
  }
  function addRegion() {
    const n = emptyRegion(`Região ${regions.length + 1}`);
    setRegions((rs) => [...rs, n]);
    setActiveId(n.id);
    setShowReport(false);
    markDirty();
  }
  function removeRegion(id) {
    setRegions((rs) => {
      const filtered = rs.filter((r) => r.id !== id);
      const next = filtered.length ? filtered : [emptyRegion("Frente Norte")];
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
    markDirty();
  }

  // ---- Projeto: salvar / carregar / novo ----
  function saveProject() {
    const payload = {
      _type: "dimensionamento-drenagem-mina",
      _version: PROJECT_FILE_VERSION,
      savedAt: new Date().toISOString(),
      projectName,
      regions,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (projectName || "projeto").trim().replace(/[^\w\-À-ÿ ]+/g, "").replace(/\s+/g, "_");
    a.href = url;
    a.download = `${safeName || "projeto"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    setLastSavedAt(new Date());
  }

  function triggerLoadProject() {
    setImportError("");
    fileInputRef.current?.click();
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.regions) || data.regions.length === 0) {
          throw new Error("Arquivo não contém regiões válidas.");
        }
        // Validação leve de forma — preenche campos ausentes com os defaults de uma região vazia
        const template = emptyRegion();
        const sanitized = data.regions.map((r) => ({
          ...emptyRegion(r.name || ""),
          ...r,
          id: r.id || uid(),
          hydro: { ...template.hydro, ...(r.hydro || {}) },
          basin: { ...template.basin, ...(r.basin || {}) },
          channel: { ...template.channel, ...(r.channel || {}) },
          pipe: { ...template.pipe, ...(r.pipe || {}) },
        }));
        setRegions(sanitized);
        setActiveId(sanitized[0].id);
        setProjectName(data.projectName || file.name.replace(/\.json$/i, ""));
        setShowReport(false);
        setDirty(false);
        setLastSavedAt(null);
        setImportError("");
      } catch (err) {
        setImportError("Não foi possível abrir este arquivo. Verifique se é um projeto exportado por este app.");
      }
    };
    reader.onerror = () => setImportError("Falha ao ler o arquivo selecionado.");
    reader.readAsText(file);
  }

  function newProject() {
    if (dirty && !window.confirm("Há alterações não salvas neste projeto. Criar um novo projeto mesmo assim?")) {
      return;
    }
    const fresh = emptyRegion("Frente Norte");
    setRegions([fresh]);
    setActiveId(fresh.id);
    setProjectName("Projeto sem título");
    setShowReport(false);
    setDirty(false);
    setLastSavedAt(null);
    setImportError("");
  }

  // ---- Cálculos derivados por região ----
  const computed = useMemo(() => {
    const map = {};
    for (const r of regions) {
      const C = num(r.hydro.C);
      const I = num(r.hydro.I);
      const A = num(r.hydro.A_ha);
      const TR = num(r.hydro.TR);
      const durationH = num(r.hydro.durationH);
      const Q = calcQ({ C, I, A });

      let basin = null;
      if (r.basin.enabled) {
        basin = calcBasinVolume({ A_ha: A, C, I, TR_factor: TR, Q, peakRatio: durationH });
      }

      let channel = null;
      if (r.channel.enabled) {
        const n = num(r.channel.n);
        const S = num(r.channel.S);
        const b = num(r.channel.b);
        const m = num(r.channel.m);
        channel = solveChannelDepth({ Q, b, m, n, S });
      }

      let pipe = null;
      if (r.pipe.enabled) {
        const n = num(r.pipe.n);
        const S = num(r.pipe.S);
        const fillRatio = num(r.pipe.fillRatio);
        pipe = chooseCommercialPipe({ Q, n, S, fillRatio });
      }

      map[r.id] = { C, I, A, TR, Q, basin, channel, pipe };
    }
    return map;
  }, [regions]);

  const activeCalc = computed[active.id];

  function toggleSection(key) {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }

  return (
    <div className="app">
      <style>{css}</style>

      {/* HEADER */}
      <header className="app__header">
        <div className="app__headertitle">
          <span className="app__eyebrow">Drenagem · Cava a céu aberto</span>
          <h1 className="app__h1">Dimensionamento por Região</h1>
        </div>
        <button className="btn btn--primary" onClick={() => setShowReport(true)}>
          <FileDown size={16} /> Gerar relatório
        </button>
      </header>

      {/* BARRA DE PROJETO */}
      <div className="projectbar">
        <input
          className="projectbar__name"
          value={projectName}
          onChange={(e) => { setProjectName(e.target.value); markDirty(); }}
          placeholder="Nome do projeto"
        />
        <span className={`projectbar__status ${dirty ? "projectbar__status--dirty" : "projectbar__status--clean"}`}>
          {dirty ? (
            <><AlertTriangle size={12} /> Alterações não salvas</>
          ) : lastSavedAt ? (
            <><CheckCircle2 size={12} /> Salvo {lastSavedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</>
          ) : (
            <>Ainda não salvo nesta sessão</>
          )}
        </span>
        <div className="projectbar__actions">
          <button className="btn btn--ghost btn--sm" onClick={newProject} title="Começar um projeto novo">
            Novo
          </button>
          <button className="btn btn--ghost btn--sm" onClick={triggerLoadProject} title="Carregar projeto (.json)">
            <FolderOpen size={14} /> Carregar
          </button>
          <button className="btn btn--secondary btn--sm" onClick={saveProject} title="Salvar projeto (.json)">
            <Save size={14} /> Salvar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
        </div>
      </div>
      {importError && (
        <div className="projectbar__error"><AlertTriangle size={13} /> {importError}</div>
      )}

      {!showReport ? (
        <>
          {/* TABS DE REGIÃO */}
          <nav className="regiontabs">
            {regions.map((r) => (
              <button
                key={r.id}
                className={`regiontab ${r.id === activeId ? "regiontab--active" : ""}`}
                onClick={() => setActiveId(r.id)}
              >
                <span className="regiontab__dot" />
                {r.name || "Sem nome"}
              </button>
            ))}
            <button className="regiontab regiontab--add" onClick={addRegion}>
              <Plus size={15} /> Região
            </button>
          </nav>

          {/* NOME DA REGIÃO */}
          <div className="regionbar">
            <input
              className="regionbar__input"
              value={active.name}
              placeholder="Nome da região / frente de lavra"
              onChange={(e) => updateRegion(active.id, { name: e.target.value })}
            />
            {regions.length > 1 && (
              <button className="iconbtn iconbtn--danger" onClick={() => removeRegion(active.id)} title="Remover região">
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {/* HIDROLOGIA — bloco comum */}
          <section className="card card--hydro">
            <div className="card__title">
              <Droplets size={17} />
              Hidrologia da bacia de contribuição
              <span className="card__titlenote">Método Racional · Q = C · I · A / 360</span>
            </div>
            <div className="fieldgrid">
              <Field
                label="Área de drenagem"
                unit="ha"
                value={active.hydro.A_ha}
                onChange={(v) => updateField(active.id, "hydro", "A_ha", v)}
                placeholder="ex. 4,8"
              />
              <Field
                label="Coeficiente de escoamento (C)"
                userDefined
                value={active.hydro.C}
                onChange={(v) => updateField(active.id, "hydro", "C", v)}
                placeholder="ex. 0,75"
                hint="Defina conforme cobertura/solo da frente"
              />
              <Field
                label="Intensidade pluviométrica (I)"
                unit="mm/h"
                userDefined
                value={active.hydro.I}
                onChange={(v) => updateField(active.id, "hydro", "I", v)}
                placeholder="ex. 85"
                hint="Da equação de chuva intensa local, para o TR e duração adotados"
              />
              <Field
                label="Tempo de retorno (TR)"
                unit="anos"
                userDefined
                value={active.hydro.TR}
                onChange={(v) => updateField(active.id, "hydro", "TR", v)}
                placeholder="ex. 25"
                hint="Apenas registro — deve ser coerente com a I informada"
              />
              <Field
                label="Duração equivalente"
                unit="h"
                value={active.hydro.durationH}
                onChange={(v) => updateField(active.id, "hydro", "durationH", v)}
                placeholder="1"
                hint="Usada na estimativa de volume de amortecimento"
              />
            </div>

            <div className="qresult">
              <span className="qresult__label">Vazão de projeto</span>
              <span className="qresult__value">
                {activeCalc.Q !== null ? fmt(activeCalc.Q, 3) : "—"}
                <span className="qresult__unit">m³/s</span>
              </span>
              {activeCalc.Q === null && (
                <span className="qresult__warn"><AlertTriangle size={13} /> preencha A, C e I</span>
              )}
            </div>
          </section>

          {/* BACIA */}
          <section className="card">
            <SectionHeader
              icon={Waves}
              title="Bacia de contenção / sedimentação"
              subtitle="Volume mínimo de detenção"
              open={openSections.basin}
              onToggle={() => toggleSection("basin")}
              accent="#3D7A5C"
            />
            {openSections.basin && (
              <div className="card__body">
                <div className="fieldgrid">
                  <Field
                    label="Granulometria predominante"
                    value={active.basin.grainSize}
                    onChange={(v) => updateField(active.id, "basin", "grainSize", v)}
                    placeholder="ex. silte-arenoso"
                  />
                  <Field
                    label="Borda livre (freeboard)"
                    unit="m"
                    value={active.basin.freeboard}
                    onChange={(v) => updateField(active.id, "basin", "freeboard", v)}
                  />
                  <Field
                    label="Talude interno (H:V)"
                    value={active.basin.sideSlope}
                    onChange={(v) => updateField(active.id, "basin", "sideSlope", v)}
                    hint="Mínimo recomendado 2:1"
                  />
                </div>
                <div className="resultsgrid">
                  <ResultRow
                    label="Volume mínimo de sedimentação"
                    value={activeCalc.basin?.volSediment !== undefined && activeCalc.basin?.volSediment !== null ? fmt(activeCalc.basin.volSediment, 1) : "—"}
                    unit="m³"
                    formula="93,7 m³/ha de área de drenagem (regra prática)"
                    emphasis
                  />
                  <ResultRow
                    label="Volume de amortecimento (estimado)"
                    value={activeCalc.basin?.volDetention !== undefined && activeCalc.basin?.volDetention !== null ? fmt(activeCalc.basin.volDetention, 1) : "—"}
                    unit="m³"
                    formula="½ · Q · duração equivalente (hidrograma triangular simplificado)"
                  />
                </div>
                <p className="card__footnote">
                  Trate estes dois volumes como complementares — a bacia deve acomodar o maior dos dois,
                  somado à borda livre. Para estruturas críticas, substitua a estimativa de amortecimento
                  por um hidrograma real (curva cota×volume do terreno).
                </p>
              </div>
            )}
          </section>

          {/* CANAL */}
          <section className="card">
            <SectionHeader
              icon={Droplets}
              title="Canal de drenagem"
              subtitle="Manning · seção trapezoidal"
              open={openSections.channel}
              onToggle={() => toggleSection("channel")}
              accent="#0A2F52"
            />
            {openSections.channel && (
              <div className="card__body">
                <div className="fieldgrid">
                  <Field
                    label="Coeficiente de Manning (n)"
                    userDefined
                    value={active.channel.n}
                    onChange={(v) => updateField(active.id, "channel", "n", v)}
                    placeholder="ex. 0,030"
                    hint="Depende do revestimento do canal"
                  />
                  <Field
                    label="Declividade longitudinal (S)"
                    unit="m/m"
                    value={active.channel.S}
                    onChange={(v) => updateField(active.id, "channel", "S", v)}
                    placeholder="ex. 0,02"
                  />
                  <Field
                    label="Largura de fundo (b)"
                    unit="m"
                    value={active.channel.b}
                    onChange={(v) => updateField(active.id, "channel", "b", v)}
                  />
                  <Field
                    label="Talude lateral (m, H:V)"
                    value={active.channel.m}
                    onChange={(v) => updateField(active.id, "channel", "m", v)}
                  />
                  <Field
                    label="Borda livre"
                    unit="m"
                    value={active.channel.freeboard}
                    onChange={(v) => updateField(active.id, "channel", "freeboard", v)}
                  />
                  <Field
                    label="Tipo de revestimento"
                    value={active.channel.lining}
                    onChange={(v) => updateField(active.id, "channel", "lining", v)}
                    placeholder="ex. terra natural, rip-rap, concreto"
                  />
                </div>
                <div className="resultsgrid">
                  <ResultRow
                    label="Altura de lâmina d'água (y)"
                    value={activeCalc.channel ? fmt(activeCalc.channel.y, 3) : "—"}
                    unit="m"
                    emphasis
                  />
                  <ResultRow
                    label="Altura total do canal (y + borda livre)"
                    value={activeCalc.channel ? fmt(activeCalc.channel.y + (num(active.channel.freeboard) ?? 0), 3) : "—"}
                    unit="m"
                  />
                  <ResultRow
                    label="Largura de topo"
                    value={activeCalc.channel ? fmt(activeCalc.channel.topWidth, 2) : "—"}
                    unit="m"
                  />
                  <ResultRow
                    label="Velocidade média"
                    value={activeCalc.channel ? fmt(activeCalc.channel.v, 2) : "—"}
                    unit="m/s"
                    formula="V = Q / A_molhada — confira erosão/sedimentação para o revestimento adotado"
                  />
                </div>
              </div>
            )}
          </section>

          {/* TUBO */}
          <section className="card">
            <SectionHeader
              icon={CircleDot}
              title="Tubo corrugado (PEAD)"
              subtitle="Manning · seção circular parcial"
              open={openSections.pipe}
              onToggle={() => toggleSection("pipe")}
              accent="#C2703D"
            />
            {openSections.pipe && (
              <div className="card__body">
                <div className="fieldgrid">
                  <Field
                    label="Coeficiente de Manning (n)"
                    userDefined
                    value={active.pipe.n}
                    onChange={(v) => updateField(active.id, "pipe", "n", v)}
                    placeholder="ex. 0,010 (PEAD)"
                  />
                  <Field
                    label="Declividade (S)"
                    unit="m/m"
                    value={active.pipe.S}
                    onChange={(v) => updateField(active.id, "pipe", "S", v)}
                    placeholder="ex. 0,01"
                  />
                  <Field
                    label="Fator de enchimento admissível"
                    value={active.pipe.fillRatio}
                    onChange={(v) => updateField(active.id, "pipe", "fillRatio", v)}
                    hint="1,0 = usa vazão máxima teórica (~91% do Ø); reduza para folga"
                  />
                  <Field
                    label="Recobrimento / carga sobre o tubo"
                    value={active.pipe.cover}
                    onChange={(v) => updateField(active.id, "pipe", "cover", v)}
                    placeholder="ex. tráfego de fora-de-estrada, 1,2 m"
                  />
                </div>
                <div className="resultsgrid">
                  {activeCalc.pipe?.overflow ? (
                    <div className="resultrow resultrow--alert">
                      <AlertTriangle size={14} /> Nenhum diâmetro comercial (até {COMMERCIAL_DIAMETERS_MM.at(-1)} mm) atende essa vazão com os parâmetros atuais.
                    </div>
                  ) : (
                    <>
                      <ResultRow
                        label="Diâmetro comercial recomendado"
                        value={activeCalc.pipe?.dmm ? `DN ${activeCalc.pipe.dmm}` : "—"}
                        unit="mm"
                        emphasis
                      />
                      <ResultRow
                        label="Grau de enchimento no DN escolhido"
                        value={activeCalc.pipe?.fillPct !== undefined ? fmt(activeCalc.pipe.fillPct, 1) : "—"}
                        unit="%"
                        formula="Recomendado manter abaixo de ~91% (vazão máxima)"
                      />
                      <ResultRow
                        label="Velocidade no tubo"
                        value={activeCalc.pipe?.v !== undefined ? fmt(activeCalc.pipe.v, 2) : "—"}
                        unit="m/s"
                      />
                    </>
                  )}
                </div>
                <p className="card__footnote">
                  Lista de diâmetros comerciais é uma referência de catálogo — confirme disponibilidade
                  com o fabricante e a classe de rigidez (SN) exigida pelo recobrimento/carga informados.
                </p>
              </div>
            )}
          </section>

          {/* OBSERVAÇÕES DA REGIÃO */}
          <section className="card">
            <div className="card__title">Observações desta região</div>
            <div className="card__body">
              <textarea
                className="textarea"
                rows={3}
                placeholder="Notas de campo, restrições, referências de norma aplicadas, etc."
                value={active.notes}
                onChange={(e) => updateRegion(active.id, { notes: e.target.value })}
              />
            </div>
          </section>
        </>
      ) : (
        <ConsolidatedReport
          regions={regions}
          computed={computed}
          onBack={() => setShowReport(false)}
          reportRef={reportRef}
          projectName={projectName}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RELATÓRIO CONSOLIDADO
// ---------------------------------------------------------------------------

function ConsolidatedReport({ regions, computed, onBack, projectName }) {
  const totalArea = regions.reduce((s, r) => s + (num(r.hydro.A_ha) ?? 0), 0);
  const totalSediment = regions.reduce((s, r) => {
    const v = computed[r.id]?.basin?.volSediment;
    return s + (v ?? 0);
  }, 0);

  function downloadCSV() {
    const rows = [
      ["Região", "Área (ha)", "C", "I (mm/h)", "TR (anos)", "Q (m³/s)",
       "Bacia - Vol sedimentação (m³)", "Bacia - Vol amortecimento (m³)",
       "Canal - n", "Canal - S (m/m)", "Canal - altura lâmina (m)", "Canal - largura topo (m)", "Canal - velocidade (m/s)",
       "Tubo - DN (mm)", "Tubo - enchimento (%)", "Tubo - velocidade (m/s)",
       "Observações"],
    ];
    regions.forEach((r) => {
      const c = computed[r.id];
      rows.push([
        r.name,
        r.hydro.A_ha, r.hydro.C, r.hydro.I, r.hydro.TR,
        c.Q !== null ? c.Q.toFixed(3) : "",
        c.basin?.volSediment !== undefined && c.basin?.volSediment !== null ? c.basin.volSediment.toFixed(1) : "",
        c.basin?.volDetention !== undefined && c.basin?.volDetention !== null ? c.basin.volDetention.toFixed(1) : "",
        r.channel.n, r.channel.S,
        c.channel ? c.channel.y.toFixed(3) : "",
        c.channel ? c.channel.topWidth.toFixed(2) : "",
        c.channel ? c.channel.v.toFixed(2) : "",
        c.pipe?.dmm ?? "",
        c.pipe?.fillPct !== undefined ? c.pipe.fillPct.toFixed(1) : "",
        c.pipe?.v !== undefined ? c.pipe.v.toFixed(2) : "",
        (r.notes || "").replace(/\n/g, " "),
      ]);
    });
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (projectName || "dimensionamento_drenagem").trim().replace(/[^\w\-À-ÿ ]+/g, "").replace(/\s+/g, "_");
    a.download = `${safeName || "dimensionamento_drenagem"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="report">
      <div className="report__toolbar">
        <button className="btn btn--ghost" onClick={onBack}>← Voltar à edição</button>
        <button className="btn btn--primary" onClick={downloadCSV}>
          <FileDown size={16} /> Exportar CSV
        </button>
      </div>

      <div className="report__sheet">
        <header className="report__header">
          <span className="report__eyebrow">{projectName || "Projeto sem título"} · Relatório consolidado</span>
          <h1 className="report__title">{regions.length} {regions.length === 1 ? "região" : "regiões"} dimensionadas</h1>
          <div className="report__summary">
            <div className="report__summaryitem">
              <span className="report__summarylabel">Área total de drenagem</span>
              <span className="report__summaryvalue">{fmt(totalArea, 1)} <small>ha</small></span>
            </div>
            <div className="report__summaryitem">
              <span className="report__summarylabel">Volume total de sedimentação (referência)</span>
              <span className="report__summaryvalue">{fmt(totalSediment, 0)} <small>m³</small></span>
            </div>
          </div>
        </header>

        {regions.map((r, idx) => {
          const c = computed[r.id];
          return (
            <article className="report__region" key={r.id}>
              <h2 className="report__regiontitle">
                <span className="report__regionindex">{String(idx + 1).padStart(2, "0")}</span>
                {r.name || "Região sem nome"}
              </h2>

              <table className="report__table">
                <tbody>
                  <tr><th colSpan={2} className="report__tablesection">Hidrologia</th></tr>
                  <tr><td>Área de drenagem</td><td>{r.hydro.A_ha || "—"} ha</td></tr>
                  <tr><td>Coeficiente de escoamento (C)</td><td>{r.hydro.C || "—"}</td></tr>
                  <tr><td>Intensidade pluviométrica (I)</td><td>{r.hydro.I || "—"} mm/h</td></tr>
                  <tr><td>Tempo de retorno (TR)</td><td>{r.hydro.TR || "—"} anos</td></tr>
                  <tr className="report__rowstrong"><td>Vazão de projeto (Q)</td><td>{c.Q !== null ? fmt(c.Q, 3) : "—"} m³/s</td></tr>

                  {r.basin.enabled && (
                    <>
                      <tr><th colSpan={2} className="report__tablesection">Bacia de contenção</th></tr>
                      <tr><td>Volume mínimo de sedimentação</td><td>{c.basin?.volSediment !== undefined && c.basin?.volSediment !== null ? fmt(c.basin.volSediment, 1) : "—"} m³</td></tr>
                      <tr><td>Volume de amortecimento (estimado)</td><td>{c.basin?.volDetention !== undefined && c.basin?.volDetention !== null ? fmt(c.basin.volDetention, 1) : "—"} m³</td></tr>
                      <tr><td>Granulometria</td><td>{r.basin.grainSize || "—"}</td></tr>
                      <tr><td>Talude interno</td><td>{r.basin.sideSlope || "—"} : 1</td></tr>
                    </>
                  )}

                  {r.channel.enabled && (
                    <>
                      <tr><th colSpan={2} className="report__tablesection">Canal de drenagem</th></tr>
                      <tr><td>Manning (n) / Declividade (S)</td><td>{r.channel.n || "—"} / {r.channel.S || "—"}</td></tr>
                      <tr><td>Largura de fundo / talude</td><td>{r.channel.b || "—"} m / {r.channel.m || "—"}:1</td></tr>
                      <tr><td>Altura de lâmina d'água</td><td>{c.channel ? fmt(c.channel.y, 3) : "—"} m</td></tr>
                      <tr><td>Largura de topo</td><td>{c.channel ? fmt(c.channel.topWidth, 2) : "—"} m</td></tr>
                      <tr><td>Velocidade média</td><td>{c.channel ? fmt(c.channel.v, 2) : "—"} m/s</td></tr>
                      <tr><td>Revestimento</td><td>{r.channel.lining || "—"}</td></tr>
                    </>
                  )}

                  {r.pipe.enabled && (
                    <>
                      <tr><th colSpan={2} className="report__tablesection">Tubo corrugado</th></tr>
                      <tr><td>Manning (n) / Declividade (S)</td><td>{r.pipe.n || "—"} / {r.pipe.S || "—"}</td></tr>
                      <tr><td>Diâmetro comercial</td><td>{c.pipe?.dmm ? `DN ${c.pipe.dmm} mm` : (c.pipe?.overflow ? "excede catálogo" : "—")}</td></tr>
                      <tr><td>Grau de enchimento</td><td>{c.pipe?.fillPct !== undefined ? fmt(c.pipe.fillPct, 1) : "—"} %</td></tr>
                      <tr><td>Velocidade</td><td>{c.pipe?.v !== undefined ? fmt(c.pipe.v, 2) : "—"} m/s</td></tr>
                      <tr><td>Recobrimento/carga</td><td>{r.pipe.cover || "—"}</td></tr>
                    </>
                  )}
                </tbody>
              </table>

              {r.notes && (
                <p className="report__notes"><strong>Observações:</strong> {r.notes}</p>
              )}
            </article>
          );
        })}

        <footer className="report__footer">
          Gerado automaticamente · Método Racional (Q = C·I·A/360) · Manning para canais e tubos ·
          Volume de sedimentação por regra prática (93,7 m³/ha) — valide premissas-chave (C, n, TR) com norma interna antes de uso em projeto executivo.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const css = `
:root {
  --navy: #0A2F52;
  --navy-light: #134070;
  --steel: #9AA7B2;
  --steel-light: #E4E8EB;
  --amber: #C2703D;
  --green: #3D7A5C;
  --bg: #F7F8F9;
  --paper: #FFFFFF;
  --ink: #1B2733;
  --ink-soft: #5B6B78;
}

* { box-sizing: border-box; }

.app {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--ink);
  min-height: 100%;
  padding: 20px 16px 48px;
  max-width: 760px;
  margin: 0 auto;
}

.app__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--navy);
}
.app__eyebrow {
  display: block;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--steel);
  font-weight: 600;
  margin-bottom: 4px;
}
.app__h1 {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 24px;
  font-weight: 700;
  color: var(--navy);
  margin: 0;
  letter-spacing: -0.01em;
}

.projectbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: var(--paper);
  border: 1px solid var(--steel-light);
  border-radius: 10px;
}
.projectbar__name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  border: none;
  background: transparent;
  padding: 4px 2px;
  flex: 1 1 160px;
  min-width: 120px;
}
.projectbar__name:focus { outline: none; border-bottom: 1.5px solid var(--navy); }
.projectbar__status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex: 0 0 auto;
}
.projectbar__status--dirty { color: var(--amber); }
.projectbar__status--clean { color: var(--green); }
.projectbar__actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: auto;
}
.projectbar__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #B0431F;
  background: #FBEAE5;
  border: 1px solid #D9866B;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
.btn:active { transform: scale(0.97); }
.btn--primary { background: var(--navy); color: white; }
.btn--primary:hover { opacity: 0.9; }
.btn--ghost { background: transparent; color: var(--navy); border: 1.5px solid var(--steel-light); }
.btn--ghost:hover { background: var(--steel-light); }
.btn--secondary { background: var(--steel-light); color: var(--navy); }
.btn--secondary:hover { background: #D7DDE2; }
.btn--sm { padding: 7px 11px; font-size: 12px; }

.regiontabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 12px;
  -webkit-overflow-scrolling: touch;
}
.regiontab {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--paper);
  border: 1.5px solid var(--steel-light);
  border-radius: 20px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-soft);
  cursor: pointer;
  font-family: inherit;
}
.regiontab__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--steel);
}
.regiontab--active {
  background: var(--navy);
  border-color: var(--navy);
  color: white;
}
.regiontab--active .regiontab__dot { background: #6FE3B4; }
.regiontab--add {
  color: var(--navy);
  border-style: dashed;
}

.regionbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.regionbar__input {
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  font-family: 'Georgia', serif;
  color: var(--navy);
  border: none;
  border-bottom: 2px dashed var(--steel-light);
  background: transparent;
  padding: 6px 2px;
}
.regionbar__input:focus { outline: none; border-bottom-color: var(--navy); }

.iconbtn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border-radius: 8px;
  border: 1.5px solid var(--steel-light);
  background: var(--paper);
  cursor: pointer;
  color: var(--ink-soft);
}
.iconbtn--danger:hover { background: #FBEAE5; border-color: #D9866B; color: #B0431F; }

.card {
  background: var(--paper);
  border: 1px solid var(--steel-light);
  border-radius: 14px;
  margin-bottom: 14px;
  overflow: hidden;
}
.card--hydro {
  border-color: var(--navy);
  border-width: 1.5px;
}
.card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--navy);
  padding: 14px 16px 0;
}
.card__titlenote {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--steel);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}
.card__body { padding: 12px 16px 16px; }
.card__footnote {
  font-size: 11.5px;
  color: var(--ink-soft);
  line-height: 1.5;
  margin: 10px 2px 0;
  padding-top: 10px;
  border-top: 1px dashed var(--steel-light);
}

.sectionhead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 14px 16px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.sectionhead__icon {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, white);
  color: var(--accent);
  flex-shrink: 0;
}
.sectionhead__text { display: flex; flex-direction: column; flex: 1; }
.sectionhead__title { font-size: 14px; font-weight: 700; color: var(--ink); }
.sectionhead__subtitle { font-size: 11.5px; color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
.sectionhead__chev { color: var(--steel); transition: transform 0.2s ease; flex-shrink: 0; }
.sectionhead__chev--open { transform: rotate(180deg); }

.fieldgrid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0 4px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1 1 150px;
  min-width: 140px;
}
.field__label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  gap: 6px;
}
.field__badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 14%, white);
  padding: 2px 6px;
  border-radius: 4px;
}
.field__inputwrap {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--steel-light);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}
.field__input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 9px 10px;
  font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  color: var(--ink);
  min-width: 0;
}
.field__input:focus { outline: none; }
.field__inputwrap:has(.field__input:focus) {
  border-color: var(--navy);
  background: white;
}
.field__unit {
  font-size: 11px;
  color: var(--steel);
  padding-right: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.field__hint {
  font-size: 10.5px;
  color: var(--steel);
  line-height: 1.3;
}

.qresult {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 14px 16px;
  background: var(--navy);
  border-radius: 10px;
}
.qresult__label {
  font-size: 12px;
  color: #C7D6E5;
  font-weight: 600;
}
.qresult__value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 22px;
  font-weight: 700;
  color: white;
}
.qresult__unit {
  font-size: 12px;
  color: #C7D6E5;
  margin-left: 4px;
  font-weight: 500;
}
.qresult__warn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #F4C28C;
  margin-left: auto;
}

.resultsgrid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.resultrow {
  background: var(--bg);
  border-radius: 8px;
  padding: 9px 12px;
  border: 1px solid var(--steel-light);
}
.resultrow--main {
  border-color: var(--navy);
  background: color-mix(in srgb, var(--navy) 6%, white);
}
.resultrow--alert {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #FBEAE5;
  border-color: #D9866B;
  color: #B0431F;
  font-size: 12.5px;
  font-weight: 600;
}
.resultrow__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.resultrow__label { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
.resultrow__value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 700;
  color: var(--navy);
  white-space: nowrap;
}
.resultrow__unit { font-size: 11px; color: var(--steel); margin-left: 4px; font-weight: 500; }
.resultrow__formula {
  display: block;
  font-size: 10.5px;
  color: var(--steel);
  margin-top: 3px;
  font-style: italic;
}

.textarea {
  width: 100%;
  border: 1.5px solid var(--steel-light);
  border-radius: 8px;
  background: var(--bg);
  padding: 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--ink);
  resize: vertical;
}
.textarea:focus { outline: none; border-color: var(--navy); background: white; }

/* ---- RELATÓRIO ---- */
.report__toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}
.report__sheet {
  background: var(--paper);
  border-radius: 14px;
  border: 1px solid var(--steel-light);
  padding: 28px 22px;
}
.report__header { border-bottom: 3px solid var(--navy); padding-bottom: 18px; margin-bottom: 20px; }
.report__eyebrow {
  display: block;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--steel);
  font-weight: 700;
  margin-bottom: 6px;
}
.report__title {
  font-family: Georgia, serif;
  font-size: 22px;
  color: var(--navy);
  margin: 0 0 14px;
}
.report__summary { display: flex; gap: 24px; flex-wrap: wrap; }
.report__summaryitem { display: flex; flex-direction: column; gap: 2px; }
.report__summarylabel { font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.report__summaryvalue { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 700; color: var(--navy); }
.report__summaryvalue small { font-size: 11px; color: var(--steel); }

.report__region { margin-bottom: 26px; }
.report__regiontitle {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: Georgia, serif;
  font-size: 17px;
  color: var(--ink);
  border-bottom: 1.5px solid var(--steel-light);
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.report__regionindex {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: white;
  background: var(--navy);
  border-radius: 4px;
  padding: 2px 6px;
}
.report__table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.report__table td, .report__table th { padding: 6px 4px; text-align: left; }
.report__table td:first-child { color: var(--ink-soft); width: 60%; }
.report__table td:last-child { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--ink); text-align: right; }
.report__tablesection {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--steel);
  padding-top: 14px !important;
  border-bottom: 1px solid var(--steel-light);
}
.report__rowstrong td { font-weight: 700; color: var(--navy) !important; background: color-mix(in srgb, var(--navy) 6%, white); }
.report__notes { font-size: 12px; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }
.report__footer {
  font-size: 10.5px;
  color: var(--steel);
  border-top: 1px dashed var(--steel-light);
  padding-top: 14px;
  margin-top: 10px;
  line-height: 1.6;
}

@media (max-width: 420px) {
  .field { flex: 1 1 100%; }
  .app__h1 { font-size: 20px; }
}
`;
