import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Window } from "@/ui/Window";
import { Taskbar } from "@/ui/Taskbar";
import { Desktop } from "@/features/Desktop";
import { centeredOrigin, clampWindowSize, pageHeight, windowWidth } from "@/lib/windowManager";

type Layout = { x: number; y: number; width: number; height: number; minimized: boolean };

function initialLayout(): Layout {
  const height = pageHeight(window.innerHeight);
  const origin = centeredOrigin(window.innerWidth, window.innerHeight, height);
  const width = Math.min(960, Math.max(windowWidth(window.innerWidth), window.innerWidth - 640));
  return { x: Math.max(8, (window.innerWidth - width) / 2), y: origin.y, width, height, minimized: false };
}

/** Standalone documents share the full desktop and keep a draggable, resizable document window. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const home = () => navigate("/", { state: { fromPage: true } });
  const [layout, setLayout] = useState<Layout>(initialLayout);

  const toggleMinimized = useCallback(() => setLayout((l) => ({ ...l, minimized: !l.minimized })), []);

  return (
    <>
      <div className="page">
        <Desktop onOpen={(id) => navigate(`/?do=${id}`)} onHome={home} obscured={false} />
        <div className="shell">
          <Window
            title={title}
            onClose={home}
            layout={{
              x: layout.x,
              y: layout.y,
              width: layout.width,
              height: layout.height,
              zIndex: 1,
              visible: !layout.minimized,
              onFocus: () => {},
              onMinimize: () => setLayout((l) => ({ ...l, minimized: true })),
              onMove: (x, y) => setLayout((l) => ({ ...l, x, y })),
              onResize: (width, height) => setLayout((l) => ({ ...l, ...clampWindowSize(width, height) })),
            }}
          >
            <div className="stack">{children}</div>
          </Window>
          <p className="shell__hint">
            <Link to="/" state={{ fromPage: true }}>Back to the desktop</Link>
          </p>
        </div>
      </div>
      <Taskbar
        windows={[{ id: title, title, minimized: layout.minimized, focused: !layout.minimized }]}
        onToggle={toggleMinimized}
        onStart={home}
      />
    </>
  );
}
