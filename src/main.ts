import { mount } from "svelte";
import AnkiConnectProbe from "./lib/AnkiConnectProbe.svelte";
import App from "./App.svelte";
import DictionaryManagementProbe from "./lib/DictionaryManagementProbe.svelte";
import LookupPopupProbe from "./lib/LookupPopupProbe.svelte";
import LookupPerformanceProbe from "./lib/LookupPerformanceProbe.svelte";
import ReaderVisualProbe from "./lib/reader/ReaderVisualProbe.svelte";

const params = new URLSearchParams(window.location.search);
const Component = params.has("readerVisualProbe")
  ? ReaderVisualProbe
  : params.has("lookupPerformanceProbe")
    ? LookupPerformanceProbe
  : params.has("ankiConnectProbe")
    ? AnkiConnectProbe
  : params.has("dictionaryManagementProbe")
    ? DictionaryManagementProbe
  : params.has("lookupPopupProbe")
    ? LookupPopupProbe
    : App;

const app = mount(Component, {
  target: document.getElementById("app")!,
});

export default app;
