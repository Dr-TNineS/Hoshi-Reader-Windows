<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";

  let {
    coverPath,
    onFailure = () => {},
  }: {
    coverPath: string;
    onFailure?: () => void;
  } = $props();

  let imageUrl = $state("");
  let failed = false;
  let objectUrl: string | null = null;
  let runId = 0;

  const maxCoverDimension = 768;

  function releaseObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function markFailed() {
    if (failed) return;
    failed = true;
    onFailure();
  }

  function coverSourceUrl(path: string): string {
    try {
      return convertFileSrc(path);
    } catch {
      return path;
    }
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Cover image failed to load."));
      image.src = url;
    });
  }

  async function createDisplayImageUrl(sourceUrl: string, image: HTMLImageElement): Promise<string> {
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!Number.isFinite(longest) || longest <= maxCoverDimension) {
      return sourceUrl;
    }

    const scale = maxCoverDimension / longest;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return sourceUrl;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) return sourceUrl;
    releaseObjectUrl();
    objectUrl = URL.createObjectURL(blob);
    return objectUrl;
  }

  async function prepareCover() {
    const currentRun = ++runId;
    failed = false;
    releaseObjectUrl();
    const sourceUrl = coverSourceUrl(coverPath);
    imageUrl = sourceUrl;

    let image: HTMLImageElement;
    try {
      image = await loadImage(sourceUrl);
    } catch {
      if (currentRun !== runId) return;
      markFailed();
      return;
    }

    try {
      const displayUrl = await createDisplayImageUrl(sourceUrl, image);
      if (currentRun !== runId) return;
      imageUrl = displayUrl;
    } catch {
      if (currentRun !== runId) return;
      imageUrl = sourceUrl;
    }
  }

  $effect(() => {
    coverPath;
    prepareCover();
  });

  onDestroy(() => {
    runId += 1;
    releaseObjectUrl();
  });
</script>

{#if imageUrl}
  <img src={imageUrl} alt="" loading="lazy" decoding="async" onerror={markFailed} />
{/if}
