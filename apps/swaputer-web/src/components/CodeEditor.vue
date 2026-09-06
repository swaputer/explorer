<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags } from "@lezer/highlight";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const language = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/0x[0-9a-fA-F]+|\d+/)) return "number";
    if (stream.match(/\b(contract|interface|constructor|function|event|indexed|returns|view|external|internal|mapping|uint256|int256|bool|account|address|bytes32|if|else|while|for|return|require|revert|emit|true|false|call|staticcall|create)\b/)) return "keyword";
    if (stream.match(/\b(msg|tx|world|buy|block|gas|this)\b/)) return "variableName.special";
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return "variableName";
    if (stream.match(/=>|==|!=|<=|>=|&&|\|\||<<|>>|[=+\-*/%<>!~&|^]/)) return "operator";
    stream.next(); return null;
  }
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff5bd0" },
  { tag: tags.number, color: "#f2bd4b" },
  { tag: tags.comment, color: "#74747c", fontStyle: "italic" },
  { tag: tags.operator, color: "#d1d1d5" },
  { tag: tags.special(tags.variableName), color: "#7fb7ff" },
  { tag: tags.variableName, color: "#f4f4f5" }
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#101011", color: "#f4f4f5", fontSize: "13px" },
  ".cm-content": { padding: "14px 0 64px", caretColor: "#ff37c7", fontFamily: "var(--font-mono)", lineHeight: "1.72" },
  ".cm-line": { padding: "0 20px" },
  ".cm-gutters": { backgroundColor: "#101011", color: "#66666d", border: "0", paddingLeft: "8px" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.045)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#fff" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(255,55,199,.25) !important" },
  ".cm-cursor": { borderLeftColor: "#ff37c7" },
  ".cm-scroller": { overflow: "auto" },
  "&.cm-focused": { outline: "none" }
});

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]), language, syntaxHighlighting(highlight), theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => { if (update.docChanged) emit("update:modelValue", update.state.doc.toString()); })
      ]
    })
  });
});

watch(() => props.modelValue, (next) => {
  if (!view || view.state.doc.toString() === next) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
});

onBeforeUnmount(() => view?.destroy());
</script>

<template><div ref="host" class="code-editor" /></template>
