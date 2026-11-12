/*
 * Pay with Splits: the optional script for the checkout button.
 * Without it, the button is a plain link that opens the checkout in a new tab. With it, the
 * checkout opens in a window over the shop on desktop, and in the same tab on phones, where
 * windows over a page work badly. It touches only links marked data-splits-checkout.
 */
(function () {
  function open(event) {
    var link = event.currentTarget;
    if (window.matchMedia("(max-width: 640px)").matches) return;
    var w = 480;
    var h = Math.min(820, window.screen.availHeight - 80);
    var left = Math.max(0, (window.screen.availWidth - w) / 2);
    var top = Math.max(0, (window.screen.availHeight - h) / 2);
    var win = window.open(link.href, "splits-checkout", "popup,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
    if (win) event.preventDefault();
  }
  function wire() {
    var links = document.querySelectorAll("a[data-splits-checkout]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].dataset.splitsWired) continue;
      links[i].dataset.splitsWired = "1";
      links[i].addEventListener("click", open);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
