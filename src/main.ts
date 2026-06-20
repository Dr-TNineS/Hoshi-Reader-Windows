import { mount } from "svelte";
import AnkiConnectProbe from "./lib/AnkiConnectProbe.svelte";
import App from "./App.svelte";
import BookshelfProbe from "./lib/BookshelfProbe.svelte";
import DictionaryManagementProbe from "./lib/DictionaryManagementProbe.svelte";
import LookupPopupProbe from "./lib/LookupPopupProbe.svelte";
import ReaderVisualProbe from "./lib/reader/ReaderVisualProbe.svelte";
import ReaderTocProbe from "./lib/ReaderTocProbe.svelte";
import SettingsStateProbe from "./lib/SettingsStateProbe.svelte";
import "./lib/styles/tokens.css";

const params = new URLSearchParams(window.location.search);
const Component = params.has("readerVisualProbe")
  ? ReaderVisualProbe
  : params.has("readerTocProbe")
    ? ReaderTocProbe
  : params.has("bookshelfProbe")
    ? BookshelfProbe
  : params.has("settingsStateProbe")
      ? SettingsStateProbe
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
