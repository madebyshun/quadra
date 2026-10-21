import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Window } from "@/ui/Window";
import { Taskbar } from "@/ui/Taskbar";
import { IconMenu } from "@/features/IconMenu";
import { centeredOrigin, clampWindowSize, pageHeight, windowWidth } from "@/lib/windowManager";

type Layout = { x: number; y: number; width: number; height: number; minimized: boolean };

function initialLayout(): Layout {
  const height = pageHeight(window.innerHeight);
  const origin = centeredOrigin(window.innerWidth, window.innerHeight, height);
  return { x: origin.x, y: origin.y, width: windowWidth(window.innerWidth), height, minimized: false };
}

/**
 * Shared shell for the standalone pages: the same left-hand icon menu the
 * desktop shows, plus one window and a way back. Feature icons here are plain
 * links to `/?do=<id>` — `IconMenu` renders them that way whenever it gets no
 * `onOpen`, because there is no window manager on this page to open one into.
 *
 * The window itself now carries a real `layout` — draggable by its title bar,
 * resizable from its corner grip, minimises to the taskbar — the same as any
 * window on the multi-window desktop. There is only ever one window here, so
 * there is no z-order to track and no `FeatureId` to key it by; a plain
 * `useState` stands in for the reducer `windowManager.ts` uses for many.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const home = () => navigate("/");
  const [layout, setLayout] = useState<Layout>(initialLayout);

  const toggleMinimized = useCallback(() => setLayout((l) => ({ ...l, minimized: !l.minimized })), []);

  return (
    <>
      <div className="page">
        <IconMenu />
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
            <Link to="/">Back to the desktop</Link>
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
