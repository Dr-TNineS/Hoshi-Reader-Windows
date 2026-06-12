import { mount } from "svelte";
import App from "./App.svelte";
import ReaderVisualProbe from "./lib/reader/ReaderVisualProbe.svelte";

const Component = new URLSearchParams(window.location.search).has("readerVisualProbe")
  ? ReaderVisualProbe
  : App;

const app = mount(Component, {
  target: document.getElementById("app")!,
});

export default app;
