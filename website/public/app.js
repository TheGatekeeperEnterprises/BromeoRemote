(function () {
  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("success", "error");
    if (type) element.classList.add(type);
  }

  async function postJson(url, data) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = payload.errors ? Object.values(payload.errors)[0] : payload.error;
      throw new Error(firstError || "Aanvraag mislukt.");
    }
    return payload;
  }

  async function loadSiteConfig() {
    try {
      const response = await fetch("/api/site-config");
      if (!response.ok) return;
      const config = await response.json();
      document.querySelectorAll("[data-download]").forEach((link) => {
        const key = link.getAttribute("data-download");
        const configKey = key === "windows-portable" ? "windowsPortable" : key;
        if (!config.downloads[configKey]) {
          link.classList.add("is-pending");
          link.setAttribute("href", "#contact");
          const label = link.querySelector("span");
          const title = link.querySelector("strong");
          if (label) label.textContent = "Downloadlink";
          if (title) title.textContent = "Aanvragen";
        }
      });
    } catch {
      // Keep static links visible if the config endpoint is temporarily unreachable.
    }
  }

  const contactForm = document.querySelector("#contactForm");
  const contactStatus = document.querySelector("#contactStatus");
  if (contactForm) {
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(contactForm);
      const data = Object.fromEntries(formData.entries());
      const submit = contactForm.querySelector("button[type='submit']");

      try {
        if (submit) submit.disabled = true;
        setStatus(contactStatus, "Bericht wordt verstuurd...", null);
        await postJson("/api/contact", data);
        contactForm.reset();
        setStatus(contactStatus, "Bedankt, je bericht is verstuurd.", "success");
      } catch (error) {
        setStatus(contactStatus, error.message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  const newsletterForm = document.querySelector("#newsletterForm");
  const newsletterStatus = document.querySelector("#newsletterStatus");
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(newsletterForm);
      const data = Object.fromEntries(formData.entries());
      const submit = newsletterForm.querySelector("button[type='submit']");

      try {
        if (submit) submit.disabled = true;
        setStatus(newsletterStatus, "Aanmelding wordt opgeslagen...", null);
        await postJson("/api/newsletter", data);
        newsletterForm.reset();
        setStatus(newsletterStatus, "Je staat op de release-lijst.", "success");
      } catch (error) {
        setStatus(newsletterStatus, error.message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  loadSiteConfig();

  const btnMollieCheckout = document.querySelector("#btnMollieCheckout");
  if (btnMollieCheckout) {
    btnMollieCheckout.addEventListener("click", async () => {
      const email = prompt("Voer je e-mailadres in om af te rekenen:");
      if (!email) return;

      try {
        const originalText = btnMollieCheckout.textContent;
        btnMollieCheckout.textContent = "Laden...";
        btnMollieCheckout.disabled = true;

        const response = await postJson("/api/checkout", { email });
        if (response.ok && response.url) {
          window.location.href = response.url;
        } else {
          alert("Fout bij aanmaken checkout: " + (response.error || "Onbekend"));
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btnMollieCheckout.textContent = "Afrekenen (Mollie)";
        btnMollieCheckout.disabled = false;
      }
    });
  }
})();
