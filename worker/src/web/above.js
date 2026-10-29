export default function above(placement, bar) {
  let anchor = null;
  let frame = 0;
  let broken = false;
  const place = () => {
    frame = 0;
    const box = anchor && anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && anchor.getBoundingClientRect();
    const shown = box && box.height && box.bottom > 0 && box.top < innerHeight;
    bar.style.translate = `0 ${shown ? (placement.c > "c" ? box.bottom : box.top - innerHeight) : 0}px`;
  };
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };
  const find = () => {
    if (broken || !bar.isConnected || (anchor && anchor.isConnected)) return;
    let found;
    try {
      found = document.querySelector(placement.a);
    } catch {
      broken = true;
      return;
    }
    if (found !== anchor) {
      anchor = found;
      soon();
    }
  };
  ["scroll", "resize", "transitionend", "animationend"].forEach((type) => addEventListener(type, soon));
  new MutationObserver(find).observe(document, { childList: true, subtree: true });
  find();
  place();
}
