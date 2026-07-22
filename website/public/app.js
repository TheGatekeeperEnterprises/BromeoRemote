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
          link.classList.add("is-disabled");
          link.setAttribute("aria-disabled", "true");
          link.setAttribute("tabindex", "-1");
          link.textContent = "Binnenkort beschikbaar";
          link.removeAttribute("href");
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
})();
