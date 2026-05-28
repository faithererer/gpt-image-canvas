import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  Check,
  ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  SIZE_PRESETS,
  STYLE_PRESETS,
  type GalleryExportRequest,
  type GalleryImageItem,
  type GalleryResponse
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { assetDownloadUrl, assetPreviewUrl } from "../../shared/api/assets";

interface GalleryPageProps {
  onDeleted: (outputId: string) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface GalleryActionHandlers {
  onCopy: (item: GalleryImageItem) => void;
  onDelete: (item: GalleryImageItem) => void;
  onDownload: (item: GalleryImageItem) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface GallerySelectionHandlers {
  exportMode: boolean;
  onToggleSelected: (item: GalleryImageItem) => void;
  selectedOutputIds: Set<string>;
}

export function GalleryPage({ onDeleted, onReuse }: GalleryPageProps) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<GalleryImageItem[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<GalleryImageItem | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<GalleryImageItem | null>(null);
  const [deletingOutputId, setDeletingOutputId] = useState<string | null>(null);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState(false);
  const [selectedExportOutputIds, setSelectedExportOutputIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const statusTimerRef = useRef<number | undefined>();
  const copiedTimerRef = useRef<number | undefined>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadGallery(): Promise<void> {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/gallery", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await readGalleryError(response, locale, t));
        }

        const body = (await response.json()) as GalleryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("galleryServiceInvalidData"));
        }

        if (!controller.signal.aborted) {
          setItems(body.items);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("galleryLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadGallery();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    if (!selectedItem && !pendingDeleteItem) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (pendingDeleteItem) {
        setPendingDeleteItem(null);
        return;
      }

      setSelectedItem(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingDeleteItem, selectedItem]);

  useEffect(() => {
    return () => {
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => normalizeSearchText(item.prompt).includes(normalizedQuery));
  }, [items, query]);
  const itemOutputIdSet = useMemo(() => new Set(items.map((item) => item.outputId)), [items]);
  const selectedExportOutputIdSet = useMemo(() => new Set(selectedExportOutputIds), [selectedExportOutputIds]);
  const filteredExportOutputIds = useMemo(() => filteredItems.map((item) => item.outputId), [filteredItems]);
  const selectedFilteredExportCount = useMemo(
    () => filteredExportOutputIds.filter((outputId) => selectedExportOutputIdSet.has(outputId)).length,
    [filteredExportOutputIds, selectedExportOutputIdSet]
  );
  const featuredItem = filteredItems[0] ?? null;
  const gridItems = featuredItem ? filteredItems.slice(1) : filteredItems;
  const actionHandlers: GalleryActionHandlers = {
    onCopy: (item) => void copyPrompt(item),
    onDelete: requestDelete,
    onDownload: downloadItem,
    onReuse
  };
  const selectionHandlers: GallerySelectionHandlers = {
    exportMode,
    onToggleSelected: toggleExportSelection,
    selectedOutputIds: selectedExportOutputIdSet
  };

  useEffect(() => {
    setSelectedExportOutputIds((current) => {
      const next = current.filter((outputId) => itemOutputIdSet.has(outputId));
      return next.length === current.length ? current : next;
    });
  }, [itemOutputIdSet]);

  function showStatus(message: string): void {
    window.clearTimeout(statusTimerRef.current);
    setError("");
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage("");
    }, 3200);
  }

  function togglePrompt(outputId: string): void {
    setExpandedPrompts((current) => ({
      ...current,
      [outputId]: !current[outputId]
    }));
  }

  function openExportMode(): void {
    setError("");
    setExportMode(true);
  }

  function closeExportMode(): void {
    setExportMode(false);
    setSelectedExportOutputIds([]);
    setError("");
  }

  function toggleExportSelection(item: GalleryImageItem): void {
    setError("");
    setExportMode(true);
    setSelectedExportOutputIds((current) => {
      if (current.includes(item.outputId)) {
        return current.filter((outputId) => outputId !== item.outputId);
      }

      return [...current, item.outputId];
    });
  }

  function selectFilteredExportItems(): void {
    setError("");
    setExportMode(true);
    setSelectedExportOutputIds((current) => {
      const next = new Set(current);
      filteredExportOutputIds.forEach((outputId) => {
        next.add(outputId);
      });
      return Array.from(next);
    });
  }

  function clearExportSelection(): void {
    setError("");
    setSelectedExportOutputIds([]);
  }

  async function exportSelectedItems(): Promise<void> {
    if (selectedExportOutputIds.length === 0) {
      setError(t("galleryExportSelectAtLeastOne"));
      return;
    }

    const request: GalleryExportRequest = {
      outputIds: selectedExportOutputIds
    };

    setIsExporting(true);
    setError("");

    try {
      const response = await fetch("/api/gallery/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      const archive = await response.blob();
      if (archive.size === 0) {
        throw new Error(t("galleryExportFailed"));
      }

      const archiveUrl = window.URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = archiveUrl;
      link.download = contentDispositionFileName(response.headers.get("Content-Disposition")) ?? "gpt-image-canvas-gallery.zip";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(archiveUrl), 1000);
      showStatus(t("galleryExportStarted", { count: selectedExportOutputIds.length }));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t("galleryExportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  async function copyPrompt(item: GalleryImageItem): Promise<void> {
    try {
      await writeClipboardText(item.prompt);
      window.clearTimeout(copiedTimerRef.current);
      setCopiedOutputId(item.outputId);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedOutputId((current) => (current === item.outputId ? null : current));
        copiedTimerRef.current = undefined;
      }, 1800);
      showStatus(t("galleryCopiedPrompt"));
    } catch {
      setError(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: GalleryImageItem): void {
    window.open(assetDownloadUrl(item.asset.id), "_blank", "noopener,noreferrer");
    showStatus(t("galleryOpenDownload"));
  }

  function requestDelete(item: GalleryImageItem): void {
    setError("");
    setPendingDeleteItem(item);
  }

  async function deleteItem(item: GalleryImageItem): Promise<void> {
    setDeletingOutputId(item.outputId);
    setError("");

    try {
      const response = await fetch(`/api/gallery/${encodeURIComponent(item.outputId)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      setItems((current) => current.filter((galleryItem) => galleryItem.outputId !== item.outputId));
      setSelectedItem((current) => (current?.outputId === item.outputId ? null : current));
      setCopiedOutputId((current) => (current === item.outputId ? null : current));
      setPendingDeleteItem(null);
      onDeleted(item.outputId);
      showStatus(t("galleryDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("galleryDeleteFailed"));
    } finally {
      setDeletingOutputId(null);
    }
  }

  return (
    <main className="gallery-page app-view" data-testid="gallery-page">
      <div className="gallery-page__inner">
        <header className="gallery-header">
          <div className="gallery-header__copy">
            <p className="gallery-kicker">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("galleryKicker")}
            </p>
            <h1>{t("galleryTitle")}</h1>
          </div>
          <div className="gallery-header__meta" aria-label={t("galleryHeaderMeta", { count: items.length })}>
            <strong>{items.length}</strong>
            <span>{t("galleryWorkCount")}</span>
            <span>{t("galleryWorkSort")}</span>
          </div>
          <button
            aria-pressed={exportMode}
            className="gallery-export-entry"
            data-active={exportMode}
            type="button"
            onClick={exportMode ? closeExportMode : openExportMode}
          >
            <Archive className="size-4" aria-hidden="true" />
            {exportMode ? t("galleryExportExit") : t("galleryExportMode")}
          </button>
          <div className="gallery-search" role="search">
            <Search className="size-4" aria-hidden="true" />
            <input
              aria-label={t("gallerySearchAria")}
              className="gallery-search__input"
              data-testid="gallery-search"
              id="gallery-search-input"
              name="gallery-search"
              placeholder={t("gallerySearchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        {error ? (
          <div className="gallery-alert gallery-alert--error" data-testid="gallery-error" role="alert">
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="gallery-alert gallery-alert--success" data-testid="gallery-message" role="status">
            <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
            <p>{statusMessage}</p>
          </div>
        ) : null}

        {exportMode ? (
          <GalleryExportBar
            filteredCount={filteredItems.length}
            filteredSelectedCount={selectedFilteredExportCount}
            isExporting={isExporting}
            selectedCount={selectedExportOutputIds.length}
            onClear={clearExportSelection}
            onExport={() => void exportSelectedItems()}
            onSelectFiltered={selectFilteredExportItems}
          />
        ) : null}

        {isLoading ? (
          <div className="gallery-empty-state" data-testid="gallery-loading" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p>{t("galleryLoading")}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="gallery-empty-state" data-testid="gallery-empty">
            <ImageIcon className="size-7" aria-hidden="true" />
            <div>
              <p>{items.length === 0 ? t("galleryEmpty") : t("galleryNoMatches")}</p>
              <span>{items.length === 0 ? t("galleryEmptyHint") : t("galleryNoMatchesHint")}</span>
            </div>
          </div>
        ) : (
          <>
            {featuredItem ? (
              <FeaturedGalleryItem
                copied={copiedOutputId === featuredItem.outputId}
                deleting={deletingOutputId === featuredItem.outputId}
                expanded={Boolean(expandedPrompts[featuredItem.outputId])}
                item={featuredItem}
                onOpen={setSelectedItem}
                onTogglePrompt={togglePrompt}
                selection={selectionHandlers}
                {...actionHandlers}
              />
            ) : null}

            {gridItems.length > 0 ? (
              <div className="gallery-grid" data-testid="gallery-grid">
                {gridItems.map((item) => (
                  <GalleryCard
                    copied={copiedOutputId === item.outputId}
                    deleting={deletingOutputId === item.outputId}
                    expanded={Boolean(expandedPrompts[item.outputId])}
                    item={item}
                    key={item.outputId}
                    onOpen={setSelectedItem}
                    onTogglePrompt={togglePrompt}
                    selection={selectionHandlers}
                    {...actionHandlers}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectedItem ? (
        <GalleryDetailDialog
          copied={copiedOutputId === selectedItem.outputId}
          deleting={deletingOutputId === selectedItem.outputId}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onCopy={() => void copyPrompt(selectedItem)}
          onDelete={() => requestDelete(selectedItem)}
          onDownload={() => downloadItem(selectedItem)}
          onReuse={() => onReuse(selectedItem)}
        />
      ) : null}

      {pendingDeleteItem ? (
        <DeleteGalleryDialog
          deleting={deletingOutputId === pendingDeleteItem.outputId}
          item={pendingDeleteItem}
          onCancel={() => setPendingDeleteItem(null)}
          onConfirm={() => void deleteItem(pendingDeleteItem)}
        />
      ) : null}
    </main>
  );
}

function GalleryExportBar({
  filteredCount,
  filteredSelectedCount,
  isExporting,
  selectedCount,
  onClear,
  onExport,
  onSelectFiltered
}: {
  filteredCount: number;
  filteredSelectedCount: number;
  isExporting: boolean;
  selectedCount: number;
  onClear: () => void;
  onExport: () => void;
  onSelectFiltered: () => void;
}) {
  const { t } = useI18n();
  const allFilteredSelected = filteredCount > 0 && filteredSelectedCount === filteredCount;

  return (
    <div className="gallery-export-bar" role="region" aria-label={t("galleryExportBarLabel")}>
      <div className="gallery-export-bar__summary" aria-live="polite">
        <span className="gallery-export-bar__mark" aria-hidden="true">
          <Archive className="size-4" />
        </span>
        <strong>{t("galleryExportSelectedCount", { count: selectedCount })}</strong>
        <span>{t("galleryExportVisibleCount", { selected: filteredSelectedCount, total: filteredCount })}</span>
      </div>
      <div className="gallery-export-bar__actions">
        <button
          className="secondary-action gallery-export-bar__button h-10"
          disabled={filteredCount === 0 || allFilteredSelected || isExporting}
          type="button"
          onClick={onSelectFiltered}
        >
          {t("galleryExportSelectVisible", { count: filteredCount })}
        </button>
        <button
          className="secondary-action gallery-export-bar__button h-10"
          disabled={selectedCount === 0 || isExporting}
          type="button"
          onClick={onClear}
        >
          {t("galleryExportClear")}
        </button>
        <button
          className="gallery-export-bar__primary h-10"
          disabled={selectedCount === 0 || isExporting}
          type="button"
          onClick={onExport}
        >
          {isExporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
          {t("galleryExportZip", { count: selectedCount })}
        </button>
      </div>
    </div>
  );
}

function FeaturedGalleryItem({
  copied,
  deleting,
  expanded,
  item,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onTogglePrompt,
  selection
}: {
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
  selection: GallerySelectionHandlers;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();
  const selected = selection.selectedOutputIds.has(item.outputId);

  return (
    <article className="gallery-feature" data-export-mode={selection.exportMode} data-selected={selected} data-testid="gallery-feature">
      <div className="gallery-feature__media">
        {selection.exportMode ? <GallerySelectToggle item={item} selected={selected} onToggle={selection.onToggleSelected} /> : null}
        <button
          aria-label={t("galleryActionOpenLatest", { excerpt: promptExcerpt(item.prompt) })}
          className="gallery-feature__image-button"
          style={galleryImageRatioStyle(item)}
          type="button"
          onClick={() => onOpen(item)}
        >
          <img
            alt={item.prompt}
            className="gallery-feature__image"
            height={item.asset.height}
            src={assetPreviewUrl(item.asset.id, 1024)}
            width={item.asset.width}
          />
          <span className="gallery-feature__badge">{t("galleryBadgeLatest")}</span>
          <span className="gallery-card__zoom">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="gallery-feature__body">
        <GalleryTags item={item} />
        <div className="gallery-feature__prompt-panel">
          <CollapsiblePrompt
            expanded={expanded}
            label={t("galleryPromptLabel")}
            lines={4}
            text={item.prompt}
            onToggle={() => onTogglePrompt(item.outputId)}
          />
        </div>
        <div className="gallery-feature__footer">
          <div className="gallery-feature__meta">
            <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
              {formatCreatedTime(item.createdAt, formatDateTime)}
            </span>
            <span>{item.outputFormat.toUpperCase()}</span>
            <span>{t("qualityLabel", { quality: item.quality })}</span>
          </div>
          <GalleryIconActions
            copied={copied}
            deleting={deleting}
            item={item}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GalleryCard({
  copied,
  deleting,
  expanded,
  item,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onTogglePrompt,
  selection
}: {
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
  selection: GallerySelectionHandlers;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();
  const selected = selection.selectedOutputIds.has(item.outputId);

  return (
    <article className="gallery-card" data-export-mode={selection.exportMode} data-selected={selected} data-testid="gallery-card">
      <div className="gallery-card__media">
        {selection.exportMode ? <GallerySelectToggle item={item} selected={selected} onToggle={selection.onToggleSelected} /> : null}
        <button
          aria-label={t("galleryActionOpenImage", { excerpt: promptExcerpt(item.prompt) })}
          className="gallery-card__image-button"
          style={galleryImageRatioStyle(item)}
          type="button"
          onClick={() => onOpen(item)}
        >
          <img
            alt={item.prompt}
            className="gallery-card__image"
            height={item.asset.height}
            loading="lazy"
            src={assetPreviewUrl(item.asset.id, 512)}
            width={item.asset.width}
          />
          <span className="gallery-card__zoom">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="gallery-card__body">
        <GalleryTags item={item} compact />
        <CollapsiblePrompt
          expanded={expanded}
          label={t("galleryPromptLabel")}
          lines={2}
          text={item.prompt}
          onToggle={() => onTogglePrompt(item.outputId)}
        />
        <div className="gallery-card__footer">
          <span className="gallery-time-tag">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {formatCreatedTime(item.createdAt, formatDateTime)}
          </span>
          <GalleryIconActions
            copied={copied}
            deleting={deleting}
            item={item}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GallerySelectToggle({
  item,
  selected,
  onToggle
}: {
  item: GalleryImageItem;
  selected: boolean;
  onToggle: (item: GalleryImageItem) => void;
}) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);
  const label = selected ? t("galleryActionDeselectExport", { excerpt }) : t("galleryActionSelectExport", { excerpt });

  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className="gallery-select-toggle"
      data-selected={selected}
      title={label}
      type="button"
      onClick={() => onToggle(item)}
    >
      <span className="gallery-select-toggle__box" aria-hidden="true">
        {selected ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}

function GalleryIconActions({
  copied,
  deleting,
  item,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
  deleting: boolean;
  item: GalleryImageItem;
} & GalleryActionHandlers) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);

  return (
    <div className="gallery-card__actions">
      <button
        aria-label={copied ? t("galleryCopiedPrompt") : t("galleryActionCopyPrompt", { excerpt })}
        className="gallery-icon-action"
        data-copied={copied}
        title={copied ? t("galleryCopiedPrompt") : t("galleryPromptLabel")}
        type="button"
        onClick={() => onCopy(item)}
      >
        <span className="gallery-icon-action__icon-stack" aria-hidden="true">
          <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
          <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
        </span>
      </button>
      <button
        aria-label={t("galleryActionDownloadImage", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryDownloadOriginal")}
        type="button"
        onClick={() => onDownload(item)}
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionReusePrompt", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryReuseToCanvas")}
        type="button"
        onClick={() => onReuse(item)}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionDeleteImage", { excerpt })}
        className="gallery-icon-action gallery-icon-action--danger"
        disabled={deleting}
        title={t("galleryRemovedTitle")}
        type="button"
        onClick={() => onDelete(item)}
      >
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

function GalleryTags({ item, compact = false }: { item: GalleryImageItem; compact?: boolean }) {
  const { t } = useI18n();
  const styleLabel = styleTagLabel(item.presetId, t);
  const sizeLabel = sizeTagLabel(item, t);

  return (
    <div className="gallery-tags" data-compact={compact}>
      <span className="gallery-tag gallery-tag--mode">{t("galleryModeLabel", { mode: item.mode })}</span>
      {styleLabel ? (
        <span className="gallery-tag gallery-tag--style">
          <Palette className="size-3.5" aria-hidden="true" />
          {styleLabel}
        </span>
      ) : null}
      <span className="gallery-tag gallery-tag--size">
        <Ruler className="size-3.5" aria-hidden="true" />
        {sizeLabel}
      </span>
    </div>
  );
}

function CollapsiblePrompt({
  expanded,
  label,
  lines,
  text,
  onToggle
}: {
  expanded: boolean;
  label: string;
  lines: 2 | 4 | 8;
  text: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="gallery-prompt-block">
      <div className="gallery-prompt-heading">
        <h3 className="gallery-prompt-label">{label}</h3>
        <button
          aria-expanded={expanded}
          className="gallery-prompt-toggle"
          data-expanded={expanded}
          type="button"
          onClick={onToggle}
        >
          {expanded ? t("galleryToggleCollapse") : t("galleryToggleExpand")}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className="gallery-prompt-text" data-expanded={expanded} data-lines={lines}>
        {text}
      </p>
    </section>
  );
}

function GalleryDetailDialog({
  copied,
  deleting,
  item,
  onClose,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
  deleting: boolean;
  item: GalleryImageItem;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onReuse: () => void;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { formatDateTime, t } = useI18n();

  return (
    <div className="gallery-modal-backdrop app-modal-backdrop" data-testid="gallery-detail" role="presentation">
      <div aria-labelledby="gallery-detail-title" aria-modal="true" className="gallery-modal app-modal-surface" role="dialog">
        <header className="gallery-modal__header">
          <div className="gallery-modal__title">
            <p>{t("galleryDetailEyebrow")}</p>
            <h2 id="gallery-detail-title">{t("galleryDetailTitle")}</h2>
            <GalleryTags item={item} />
          </div>
          <button aria-label={t("commonClose")} className="gallery-icon-action gallery-modal__close" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-modal__body">
          <div className="gallery-modal__media">
            <img
              alt={item.prompt}
              className="gallery-modal__image"
              height={item.asset.height}
              src={item.asset.url}
              width={item.asset.width}
            />
          </div>

          <aside className="gallery-modal__copy">
            <div className="gallery-modal__meta">
              <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
                {formatCreatedTime(item.createdAt, formatDateTime)}
              </span>
              <span>{item.outputFormat.toUpperCase()}</span>
              <span>{t("qualityLabel", { quality: item.quality })}</span>
            </div>
            <CollapsiblePrompt
              expanded={promptExpanded}
              label={t("galleryPromptLabel")}
              lines={8}
              text={item.prompt}
              onToggle={() => setPromptExpanded((current) => !current)}
            />
          </aside>
        </div>

        <footer className="gallery-modal__actions">
          <button
            aria-label={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            className="secondary-action gallery-copy-action h-10"
            data-copied={copied}
            title={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            type="button"
            onClick={onCopy}
          >
            <span className="gallery-icon-action__icon-stack" aria-hidden="true">
              <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
              <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
            </span>
            {t("commonCopy")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onDownload}>
            <Download className="size-4" aria-hidden="true" />
            {t("commonDownload")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onReuse}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("commonReuse")}
          </button>
          <button className="secondary-action h-10 text-red-700 hover:text-red-800" disabled={deleting} type="button" onClick={onDelete}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("commonRemove")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteGalleryDialog({
  deleting,
  item,
  onCancel,
  onConfirm
}: {
  deleting: boolean;
  item: GalleryImageItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-delete-description"
        aria-labelledby="gallery-delete-title"
        aria-modal="true"
        className="gallery-confirm app-modal-surface"
        role="dialog"
      >
        <div className="gallery-confirm__icon">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="gallery-confirm__copy">
          <h2 id="gallery-delete-title">{t("galleryConfirmDeleteTitle")}</h2>
          <p id="gallery-delete-description">
            {t("galleryConfirmDeleteBody", { excerpt: promptExcerpt(item.prompt) })}
          </p>
        </div>
        <div className="gallery-confirm__actions">
          <button className="secondary-action h-10" disabled={deleting} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="danger-action h-10" disabled={deleting} type="button" onClick={onConfirm}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("galleryConfirmRemove")}
          </button>
        </div>
      </div>
    </div>
  );
}

function styleTagLabel(presetId: string, t: Translate): string {
  if (presetId === "none") {
    return "";
  }

  const preset = STYLE_PRESETS.find((item) => item.id === presetId);
  return preset ? t("stylePresetLabel", { presetId: preset.id, fallback: preset.label }) : "";
}

function sizeTagLabel(item: GalleryImageItem, t: Translate): string {
  const preset = SIZE_PRESETS.find((sizePreset) => sizePreset.width === item.size.width && sizePreset.height === item.size.height);
  const presetLabel = preset ? t("sizePresetLabel", { presetId: preset.id, fallback: preset.label }) : t("customSize");
  return `${presetLabel} · ${item.size.width} x ${item.size.height}`;
}

type GalleryImageRatioStyle = CSSProperties & {
  "--gallery-image-ratio": string;
};

function galleryImageRatioStyle(item: GalleryImageItem): GalleryImageRatioStyle {
  const width = positiveDimension(item.asset.width) ?? positiveDimension(item.size.width) ?? 4;
  const height = positiveDimension(item.asset.height) ?? positiveDimension(item.size.height) ?? 3;

  return {
    "--gallery-image-ratio": `${width} / ${height}`
  };
}

function positiveDimension(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function promptExcerpt(promptValue: string): string {
  const compact = promptValue.replace(/\s+/gu, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function formatCreatedTime(value: string, formatDateTime: (value: string) => string): string {
  return formatDateTime(value);
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

async function readGalleryError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("galleryRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("galleryRequestFailed", { status: response.status });
  }
}

function contentDispositionFileName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(value);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return undefined;
    }
  }

  const quoted = /filename="([^"]+)"/iu.exec(value);
  if (quoted?.[1]) {
    return quoted[1];
  }

  const unquoted = /filename=([^;]+)/iu.exec(value);
  return unquoted?.[1]?.trim();
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}
