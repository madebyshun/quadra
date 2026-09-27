import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Window } from "@/ui/Window";
import { Taskbar } from "@/ui/Taskbar";

/** Shared shell for the standalone pages: one window, and a way back. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const home = () => navigate("/");

  return (
    <>
      <div className="shell">
        <Window title={title} onClose={home}>
          <div className="stack">{children}</div>
        </Window>
        <p className="shell__hint">
          <Link to="/">Back to the desktop</Link>
        </p>
      </div>
      <Taskbar openWindow={title} onStart={home} />
    </>
  );
}
