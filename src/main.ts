import { mount } from "svelte";
import AnkiConnectProbe from "./lib/AnkiConnectProbe.svelte";
import App from "./App.svelte";
import BookshelfProbe from "./lib/BookshelfProbe.svelte";
import DictionaryManagementProbe from "./lib/DictionaryManagementProbe.svelte";
import DictionarySearchProbe from "./lib/DictionarySearchProbe.svelte";
import GlobalLookupSettingsProbe from "./lib/GlobalLookupSettingsProbe.svelte";
import GlobalLookupWindow from "./lib/GlobalLookupWindow.svelte";
import LookupPopupProbe from "./lib/LookupPopupProbe.svelte";
import LookupPerformanceProbe from "./lib/LookupPerformanceProbe.svelte";
import ReaderVisualProbe from "./lib/reader/ReaderVisualProbe.svelte";
import ReaderTocProbe from "./lib/ReaderTocProbe.svelte";
import SettingsStateProbe from "./lib/SettingsStateProbe.svelte";
import SasayakiPlaybackProbe from "./lib/SasayakiPlaybackProbe.svelte";
import "./lib/styles/tokens.css";

const params = new URLSearchParams(window.location.search);
const Component = params.has("globalLookup")
  ? GlobalLookupWindow
  : params.has("readerVisualProbe")
  ? ReaderVisualProbe
  : params.has("sasayakiPlaybackProbe")
    ? SasayakiPlaybackProbe
  : params.has("lookupPerformanceProbe")
    ? LookupPerformanceProbe
    : params.has("readerTocProbe")
      ? ReaderTocProbe
      : params.has("bookshelfProbe")
        ? BookshelfProbe
        : params.has("settingsStateProbe")
          ? SettingsStateProbe
          : params.has("globalLookupSettingsProbe")
            ? GlobalLookupSettingsProbe
            : params.has("ankiConnectProbe")
              ? AnkiConnectProbe
              : params.has("dictionaryManagementProbe")
                ? DictionaryManagementProbe
                : params.has("dictionarySearchProbe")
                  ? DictionarySearchProbe
                  : params.has("lookupPopupProbe")
                    ? LookupPopupProbe
                    : App;

const app = mount(Component, {
  target: document.getElementById("app")!,
});

export default app;
