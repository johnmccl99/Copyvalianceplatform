(function () {
  var t = null;
  try { t = localStorage.getItem("ds-theme"); } catch (e) {}
  if (t !== "dark" && t !== "light") t = "light";
  document.documentElement.setAttribute("data-theme", t);
})();
