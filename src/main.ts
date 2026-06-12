import { mount } from "svelte";
import App from "./App.svelte";
import DictionaryManagementProbe from "./lib/DictionaryManagementProbe.svelte";
import LookupPopupProbe from "./lib/LookupPopupProbe.svelte";
import ReaderVisualProbe from "./lib/reader/ReaderVisualProbe.svelte";

const params = new URLSearchParams(window.location.search);
const Component = params.has("readerVisualProbe")
  ? ReaderVisualProbe
  : params.has("dictionaryManagementProbe")
    ? DictionaryManagementProbe
  : params.has("lookupPopupProbe")
    ? LookupPopupProbe
    : App;

const app = mount(Component, {
  target: document.getElementById("app")!,
});

export default app;
