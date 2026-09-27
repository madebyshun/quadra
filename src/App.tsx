import { useCallback, useEffect } from "react";
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { Desktop } from "@/features/Desktop";
import { FeaturePanel } from "@/features/FeaturePanel";
import { resolveFeature } from "@/features/registry";
import { Window } from "@/ui/Window";
import { Taskbar } from "@/ui/Taskbar";
import { Docs } from "@/pages/Docs";
import { ApiPage } from "@/pages/ApiPage";
import { Verify } from "@/pages/Verify";
import { NotFound } from "@/pages/NotFound";
import { AdaptersProvider } from "@/adapters/AdaptersProvider";

function Home() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const feature = resolveFeature(params.get("do"));

  const close = useCallback(() => navigate("/", { replace: false }), [navigate]);

  useEffect(() => {
    if (!feature) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feature, close]);

  return (
    <>
      {feature ? (
        <div className="shell">
          <Window title={feature.window} onClose={close}>
            <FeaturePanel feature={feature} />
          </Window>
          {/*
            `shell__hint` and nothing else. It sits on the desktop rather than inside
            the window, so it is the one muted line on this page that needs white and
            a shadow instead of the grey that reads as muted on beige. It carried
            `dim` too until it was looked at in a browser, and `dim` is declared later
            in the stylesheet at equal specificity, so it won: dark grey on a blue
            gradient, effectively invisible. Nothing in jsdom can see that — both
            class names were present and the text was in the document, so 473 tests
            agreed it was fine.
          */}
          <p className="shell__hint">Esc closes this.</p>
        </div>
      ) : (
        <Desktop />
      )}
      <Taskbar openWindow={feature?.window ?? null} onStart={close} />
    </>
  );
}

export function App() {
  return (
    <AdaptersProvider>
      <div className="desktop">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/api" element={<ApiPage />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </AdaptersProvider>
  );
}
