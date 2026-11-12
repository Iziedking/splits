import { Logo } from "@/components/app/logo";
import { Loader } from "@/components/app/loader";

const SEEN = "splits-near-splash";

// Runs while the page is parsed, before first paint: a visitor who saw the splash in this tab
// session skips it, and a browser without storage simply sees it each time. The demo shop is a
// merchant's page, not Splits, so it never shows there.
const skipScript = `try{if(location.pathname.split("/").filter(Boolean).pop()==="shop"||sessionStorage.getItem("${SEEN}"))document.documentElement.dataset.splashSeen="1";else sessionStorage.setItem("${SEEN}","1")}catch(e){}`;

/**
 * The opening moment of NEAR mode: the Splits mark on teal, its pieces lighting up in turn as the
 * app loads, then the screen lifts away (globals.css `splash`). Once per tab session; reduced
 * motion removes it at once. It is decoration over a page that is already there, so it never
 * blocks reading or input for assistive technology.
 */
export function NearSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: skipScript }} />
      <div aria-hidden="true" className="splash pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-primary-fill print:hidden">
        <Loader label="Loading" className="min-h-0" markClassName="h-16 text-white" />
        <Logo tone="white" className="h-8 w-auto" />
      </div>
    </>
  );
}
