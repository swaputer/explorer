import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  LoaderCircle,
  Plus,
  Rocket,
  Save
} from "lucide-react";
import {
  EMPTY_CONTRACT,
  STUDIO_TEMPLATES,
  compileStudioSource,
  downloadStudioArtifact,
  formatStudioError,
  studioErrorLocation,
  type StudioBuild
} from "../lib/studio";

interface TinySolStudioPageProps {
  readonly onUseInDeploy: (file: File) => void;
}

type InspectorTab = "compile" | "abi" | "artifacts";
type BuildState = "idle" | "compiling" | "success" | "error";

const STORAGE_KEY = "swaputer.tinysol-studio.source.v1";

const tinySolLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { while (!stream.eol() && !stream.match("*/")) stream.next(); return "comment"; }
    if (stream.match(/0x[0-9a-fA-F]+|\d+/)) return "number";
    if (stream.match(/\b(contract|interface|constructor|function|event|indexed|returns|view|external|internal|mapping|uint256|int256|bool|account|address|bytes32|if|else|while|for|return|require|revert|emit|true|false|call|staticcall|create)\b/)) return "keyword";
    if (stream.match(/\b(msg|tx|world|buy|block|gas|this)\b/)) return "variableName.special";
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return "variableName";
    if (stream.match(/=>|==|!=|<=|>=|&&|\|\||<<|>>|[=+\-*/%<>!~&|^]/)) return "operator";
    stream.next(); return null;
  }
});

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#0c0f0e", color: "#e7eae6", fontSize: "13px" },
  ".cm-content": { padding: "22px 0 100px", caretColor: "#c8f733", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.72" },
  ".cm-line": { padding: "0 22px" },
  ".cm-gutters": { backgroundColor: "#0c0f0e", color: "#525957", border: "0", paddingLeft: "8px" },
  ".cm-activeLine": { backgroundColor: "rgba(200,247,51,.025)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9ca39f" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(200,247,51,.14) !important" },
  ".cm-cursor": { borderLeftColor: "#c8f733" },
  ".cm-scroller": { overflow: "auto" },
  "&.cm-focused": { outline: "none" }
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7db5ff" },
  { tag: tags.number, color: "#d9a8ff" },
  { tag: tags.comment, color: "#626966", fontStyle: "italic" },
  { tag: tags.operator, color: "#aeb4b0" },
  { tag: tags.special(tags.variableName), color: "#ffba75" },
  { tag: tags.variableName, color: "#dfe3df" }
]);

function compact(value: string): string { return `${value.slice(0, 14)}…${value.slice(-12)}`; }
function copy(value: string): void { void navigator.clipboard?.writeText(value); }

export function TinySolStudioPage({ onUseInDeploy }: TinySolStudioPageProps) {
  const [templateId, setTemplateId] = useState("counter");
  const [fileName, setFileName] = useState("Counter.tiny.sol");
  const [source, setSource] = useState(() => localStorage.getItem(STORAGE_KEY) || STUDIO_TEMPLATES[0]!.source);
  const [build, setBuild] = useState<StudioBuild | null>(null);
  const [buildState, setBuildState] = useState<BuildState>("idle");
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [diagnosticLine, setDiagnosticLine] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("compile");
  const [saved, setSaved] = useState(false);
  const requestId = useRef(0);

  const compile = useCallback(async (nextSource = source, foreground = true) => {
    const id = ++requestId.current;
    if (foreground) setBuildState("compiling");
    try {
      const result = await compileStudioSource(nextSource, fileName);
      if (id !== requestId.current) return;
      setBuild(result);
      setBuildState("success");
      setDiagnostic(null);
      setDiagnosticLine(null);
    } catch (error) {
      if (id !== requestId.current) return;
      const location = studioErrorLocation(error);
      setBuild(null);
      setBuildState("error");
      setDiagnostic(await formatStudioError(error));
      setDiagnosticLine(location.line ?? null);
    }
  }, [fileName, source]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void compile(source, false); }, 650);
    return () => window.clearTimeout(timeout);
  }, [compile, source]);

  const extensions = useMemo(() => [
    tinySolLanguage,
    editorTheme,
    syntaxHighlighting(highlightStyle),
    keymap.of([{ key: "Mod-Enter", run: () => { void compile(); return true; } }]),
    EditorView.lineWrapping
  ], [compile]);

  const chooseTemplate = (id: string) => {
    const template = STUDIO_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(id);
    setFileName(template.fileName);
    setSource(template.source);
    setSaved(false);
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, source);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  };

  const useInDeploy = () => {
    if (!build) return;
    onUseInDeploy(new File([new Uint8Array(build.packageBytes)], build.fileName, { type: "application/octet-stream" }));
  };

  const downloadText = (suffix: string, value: string) => {
    if (!build) return;
    downloadStudioArtifact(`${build.contractName}.${suffix}`, value, suffix.endsWith("json") ? "application/json" : "text/plain");
  };

  return (
    <main className="studio-main">
      <section className="studio-shell" aria-label="TinySol Studio">
        <header className="studio-toolbar">
          <div className="studio-title"><Code2 size={19} /><strong>TinySol Studio</strong></div>
          <label className="studio-template-label">Template
            <select value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
              {STUDIO_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="studio-toolbar-actions">
            <button type="button" onClick={save}><Save size={15} />{saved ? "Saved" : "Save"}</button>
            <button type="button" onClick={() => { setTemplateId(""); setFileName("MyContract.tiny.sol"); setSource(EMPTY_CONTRACT); }}><Plus size={16} />New</button>
            <button className="studio-compile-button" type="button" onClick={() => void compile()} disabled={buildState === "compiling"}>
              {buildState === "compiling" ? <LoaderCircle className="spin" size={16} /> : <Rocket size={16} />}
              Compile
            </button>
          </div>
        </header>

        <div className="studio-workspace">
          <aside className="studio-explorer">
            <div className="studio-pane-heading"><span>Explorer</span><Plus size={14} /></div>
            <div className="studio-folder"><FolderOpen size={14} /><span>contracts</span></div>
            <button className="studio-file studio-file-active" type="button"><FileCode2 size={14} /><span>{fileName}</span><i /></button>
            <div className="studio-examples-label">Examples</div>
            {STUDIO_TEMPLATES.map((item) => (
              <button className={`studio-file ${templateId === item.id ? "studio-file-active" : ""}`} type="button" key={item.id} onClick={() => chooseTemplate(item.id)}>
                <FileCode2 size={14} /><span><strong>{item.name}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </aside>

          <section className="studio-editor-pane">
            <div className="studio-editor-tab"><FileCode2 size={14} /><span>{fileName}</span><i /></div>
            <div className="studio-editor">
              <CodeMirror value={source} height="100%" extensions={extensions} onChange={(value) => { setSource(value); setSaved(false); }} basicSetup={{ foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: false, bracketMatching: true, closeBrackets: true, lineNumbers: true }} />
            </div>
          </section>

          <aside className="studio-inspector">
            <div className="studio-inspector-tabs" role="tablist">
              {(["compile", "abi", "artifacts"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab} onClick={() => setInspectorTab(tab)}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}
            </div>

            <div className="studio-inspector-body">
              {inspectorTab === "compile" && (
                <>
                  <div className={`studio-build-state studio-build-${buildState}`}>
                    {buildState === "error" ? <AlertCircle size={18} /> : buildState === "compiling" ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}
                    <div><strong>{buildState === "error" ? "Build failed" : buildState === "compiling" ? "Compiling…" : build ? "Build successful" : "Ready to compile"}</strong><small>{diagnostic ?? (build ? "No errors · no warnings" : "Edit your contract or choose a template")}</small></div>
                  </div>
                  <dl className="studio-build-metrics">
                    <div><dt>Code size</dt><dd>{build ? `${build.codeLength.toLocaleString()} bytes` : "—"}</dd></div>
                    <div><dt>Package size</dt><dd>{build ? `${build.packageLength.toLocaleString()} bytes` : "—"}</dd></div>
                  </dl>
                  <div className="studio-hash-block"><span>Package hash</span><div><code>{build ? compact(build.codeHash) : "Compile to generate a code hash"}</code>{build && <button type="button" onClick={() => copy(build.codeHash)} aria-label="Copy package hash"><Copy size={14} /></button>}</div></div>
                  <div className="studio-constructor"><span>Constructor</span><code>{build?.constructorSignature ?? "—"}</code></div>
                  <div className="studio-functions"><span>Functions ({build?.functions.length ?? 0})</span>{build?.functions.map((fn) => <div key={fn.selector}><code>{fn.signature}</code><small>{fn.view ? "view" : "write"}</small><ChevronRight size={14} /></div>)}</div>
                </>
              )}
              {inspectorTab === "abi" && <pre className="studio-code-preview">{build?.abi ?? "Compile a valid contract to inspect its ABI."}</pre>}
              {inspectorTab === "artifacts" && (
                <div className="studio-artifacts">
                  <p>The compiler creates one deterministic package and six review artifacts.</p>
                  <button type="button" disabled={!build} onClick={() => build && downloadStudioArtifact(build.fileName, new Uint8Array(build.packageBytes), "application/octet-stream")}><Download size={15} /><span><strong>.svm package</strong><small>Deployable MiniVM binary</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("abi.json", build!.abi)}><Download size={15} /><span><strong>ABI</strong><small>Functions and selectors</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("manifest.json", build!.manifest)}><Download size={15} /><span><strong>Manifest</strong><small>Compiler and package identity</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("svasm", build!.assembly)}><Download size={15} /><span><strong>Assembly</strong><small>Canonical lowered code</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("storage.json", build!.storage)}><Download size={15} /><span><strong>Storage layout</strong><small>Slots and namespaces</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("events.json", build!.events)}><Download size={15} /><span><strong>Events</strong><small>Topics and fields</small></span></button>
                  <button type="button" disabled={!build} onClick={() => downloadText("map.json", build!.sourceMap)}><Download size={15} /><span><strong>Source map</strong><small>Bytecode to source spans</small></span></button>
                </div>
              )}
            </div>
            <button className="studio-use-deploy" type="button" disabled={!build} onClick={useInDeploy}><span>Use in Deploy</span><ChevronRight size={18} /></button>
          </aside>
        </div>

        <footer className={`studio-status studio-status-${buildState}`}>
          <span>{buildState === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{buildState === "error" ? "Build failed" : build ? "Build successful" : "Ready"}</span>
          <span>{diagnosticLine ? `Line ${diagnosticLine}` : diagnostic ?? "No errors"}</span>
          <div><span>TinySol v1</span><span>{build ? `Code ${build.codeLength.toLocaleString()} bytes` : "Code —"}</span><span>{build ? `Package ${build.packageLength.toLocaleString()} bytes` : "Package —"}</span></div>
        </footer>
      </section>
    </main>
  );
}
