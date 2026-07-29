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
    // Keep all download links active and pointing to /download/:platform
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


  function initDownloadModal() {
    const modal = document.querySelector("#downloadModal");
    if (!modal) return;

    function openModal(e) {
      if (e) e.preventDefault();
      modal.classList.add("is-active");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeModal() {
      modal.classList.remove("is-active");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }

    // Was ".header-cta, .primary-action, ..." — both those are generic
    // styling classes reused on elements that must NOT open this modal: the
    // "Mijn Dashboard / Licentie" header link (.header-cta, links to
    // /dashboard.html) and the contact form's submit button (.primary-action,
    // no href at all). Since every element that *should* open it already
    // links to #downloads, matching on that href alone is both sufficient
    // and precise — no risk of an unrelated future button silently
    // inheriting this behavior just by sharing a styling class.
    const modalTriggers = document.querySelectorAll(".download-action.secondary, [href='#downloads']");

    modalTriggers.forEach((btn) => {
      btn.addEventListener("click", openModal);
    });

    modal.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeModal);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-active")) {
        closeModal();
      }
    });
  }

  initDownloadModal();

  // Ported from what used to be dashboard.html's own standalone <script> —
  // now the whole login/register/license/upgrade flow lives in a modal on
  // the homepage instead of a separate page. Every onclick="" attribute
  // dashboard.html used got replaced with addEventListener wiring here,
  // since (unlike dashboard.html's own inline script) this file has no
  // global-scope functions for inline handlers to call.
  function initAccountModal() {
    const modal = document.querySelector("#accountModal");
    if (!modal) return;

    const trigger = document.querySelector("#accountModalTrigger");
    let activeLicenseKey = "";
    let pendingPlan = null; // set when a pricing button opens the modal while logged out

    function openModal() {
      modal.classList.add("is-active");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeModal() {
      modal.classList.remove("is-active");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }

    modal.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-active")) closeModal();
    });

    function showTab(tab) {
      document.getElementById("tabLoginBtn").classList.toggle("active", tab === "login");
      document.getElementById("tabRegisterBtn").classList.toggle("active", tab === "register");
      document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
      document.getElementById("registerForm").style.display = tab === "register" ? "block" : "none";
      document.getElementById("forgotForm").style.display = "none";
      document.getElementById("authError").hidden = true;
      document.getElementById("regError").hidden = true;
    }
    document.querySelectorAll("[data-show-tab]").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.dataset.showTab));
    });

    function toggleForgotPassword() {
      const showingForgot = document.getElementById("forgotForm").style.display === "block";
      document.getElementById("loginForm").style.display = showingForgot ? "block" : "none";
      document.getElementById("forgotForm").style.display = showingForgot ? "none" : "block";
      document.getElementById("forgotError").hidden = true;
      document.getElementById("forgotSuccess").hidden = true;
    }
    document.getElementById("forgotPasswordLink").addEventListener("click", toggleForgotPassword);
    document.getElementById("backToLoginLink").addEventListener("click", toggleForgotPassword);

    function afterAuthSuccess(user, licenses) {
      renderDashboard(user, licenses);
      if (pendingPlan) {
        const plan = pendingPlan;
        pendingPlan = null;
        startCheckout(plan);
      }
    }

    function renderDashboard(user, licenses) {
      document.getElementById("authView").style.display = "none";
      document.getElementById("dashboardView").style.display = "block";
      document.getElementById("userEmailDisplay").textContent = user.email;
      document.querySelectorAll(".current-user-email").forEach((el) => (el.textContent = user.email));

      if (trigger) trigger.textContent = "Mijn Account";

      const activeLic = licenses && licenses.length > 0 ? licenses[0] : null;
      if (activeLic) {
        activeLicenseKey = activeLic.license_key;
        document.getElementById("licenseKeyDisplay").textContent = activeLic.license_key;
        document.getElementById("planBadge").textContent = (activeLic.plan || "Free").toUpperCase();
        document.getElementById("cancelSubLink").style.display = activeLic.plan && activeLic.plan !== "Free" ? "inline" : "none";

        if (activeLic.expires_at) {
          document.getElementById("expiresDisplay").textContent = `Geldig tot ${new Date(activeLic.expires_at).toLocaleDateString("nl-NL")}`;
        } else {
          document.getElementById("expiresDisplay").textContent = activeLic.plan === "Free" ? "Permanente gratis licentie" : "Actief abonnement";
        }
      } else {
        document.getElementById("licenseKeyDisplay").textContent = "Geen licentie gevonden";
      }
    }

    async function checkAuth({ openIfLoggedIn = false } = {}) {
      try {
        const res = await fetch("/api/user/me");
        const data = await res.json();
        if (data.ok) {
          renderDashboard(data.user, data.licenses);
          if (openIfLoggedIn) openModal();
          return true;
        }
      } catch {
        /* not logged in / offline — fall through to the logged-out state below */
      }
      document.getElementById("authView").style.display = "block";
      document.getElementById("dashboardView").style.display = "none";
      return false;
    }

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("authError");
      err.hidden = true;
      try {
        const res = await fetch("/api/user/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("loginEmail").value,
            password: document.getElementById("loginPassword").value,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          afterAuthSuccess(data.user, data.licenses);
        } else {
          err.textContent = data.error || "Inloggen mislukt.";
          err.hidden = false;
        }
      } catch {
        err.textContent = "Serverfout. Probeer opnieuw.";
        err.hidden = false;
      }
    });

    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("regError");
      err.hidden = true;
      try {
        const res = await fetch("/api/user/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("regEmail").value,
            company: document.getElementById("regCompany").value,
            password: document.getElementById("regPassword").value,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          afterAuthSuccess(data.user, [data.license]);
        } else {
          err.textContent = data.error || "Registratie mislukt.";
          err.hidden = false;
        }
      } catch {
        err.textContent = "Serverfout. Probeer opnieuw.";
        err.hidden = false;
      }
    });

    document.getElementById("forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("forgotError");
      const success = document.getElementById("forgotSuccess");
      err.hidden = true;
      success.hidden = true;
      try {
        await fetch("/api/user/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: document.getElementById("forgotEmail").value }),
        });
        success.textContent = "Als dit e-mailadres bekend is, is er een resetlink verstuurd.";
        success.hidden = false;
      } catch {
        err.textContent = "Serverfout. Probeer opnieuw.";
        err.hidden = false;
      }
    });

    document.getElementById("resetPasswordForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("resetError");
      err.hidden = true;
      try {
        const token = new URLSearchParams(window.location.search).get("resetToken");
        const res = await fetch("/api/user/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, newPassword: document.getElementById("resetNewPassword").value }),
        });
        const data = await res.json();
        if (data.ok) {
          alert("Wachtwoord ingesteld! Je kunt nu inloggen.");
          document.getElementById("resetPasswordForm").style.display = "none";
          showTab("login");
        } else {
          err.textContent = data.error || "Wachtwoord instellen mislukt.";
          err.hidden = false;
        }
      } catch {
        err.textContent = "Serverfout. Probeer opnieuw.";
        err.hidden = false;
      }
    });

    document.getElementById("copyLicenseKeyBtn").addEventListener("click", () => {
      if (!activeLicenseKey) return;
      navigator.clipboard.writeText(activeLicenseKey);
      alert("Licentiesleutel gecopieerd naar klembord!");
    });

    document.getElementById("regenerateLicenseKeyBtn").addEventListener("click", async () => {
      if (!confirm("Weet je zeker dat je een nieuwe licentiesleutel wilt genereren? De huidige sleutel werkt dan niet meer.")) return;
      try {
        const res = await fetch("/api/user/regenerate-license-key", { method: "POST" });
        const data = await res.json();
        if (data.ok && data.license) {
          activeLicenseKey = data.license.license_key;
          document.getElementById("licenseKeyDisplay").textContent = data.license.license_key;
        } else {
          alert(data.error || "Sleutel genereren mislukt.");
        }
      } catch {
        alert("Serverfout bij genereren van nieuwe sleutel.");
      }
    });

    document.getElementById("cancelSubLink").addEventListener("click", async () => {
      if (!confirm("Weet je zeker dat je je abonnement wilt opzeggen? Je account gaat direct terug naar het gratis plan.")) return;
      try {
        const res = await fetch("/api/user/cancel-subscription", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          renderDashboard({ email: document.getElementById("userEmailDisplay").textContent }, [data.license]);
        } else {
          alert(data.error || "Opzeggen mislukt.");
        }
      } catch {
        alert("Serverfout bij opzeggen van abonnement.");
      }
    });

    document.getElementById("logoutLink").addEventListener("click", async () => {
      await fetch("/api/user/logout", { method: "POST" });
      window.location.reload();
    });

    async function startCheckout(plan) {
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const data = await res.json();
        if (data.ok && data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || "Betaling starten mislukt.");
        }
      } catch {
        alert("Serverfout bij starten betaling.");
      }
    }
    modal.querySelectorAll("[data-start-checkout]").forEach((btn) => {
      btn.addEventListener("click", () => startCheckout(btn.dataset.startCheckout));
    });

    // Header trigger: just opens the modal on whatever state checkAuth()
    // already resolved (dashboard view if logged in, login tab otherwise).
    if (trigger) trigger.addEventListener("click", openModal);

    // Pricing buttons: open the modal; if already logged in, jump straight
    // to checkout, otherwise remember the plan and trigger checkout right
    // after the user logs in or registers (see afterAuthSuccess above).
    document.querySelectorAll("[data-open-account-modal]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        openModal();
        const isLoggedIn = document.getElementById("dashboardView").style.display === "block";
        if (isLoggedIn) {
          startCheckout(btn.dataset.plan);
        } else {
          pendingPlan = btn.dataset.plan;
        }
      });
    });

    // Deep links from emails / Mollie redirects land on "/" now instead of
    // "/dashboard.html" — open the modal straight into the relevant state
    // and strip the query string so refreshing doesn't repeat it.
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("resetToken");
    const paymentStatus = params.get("payment");

    if (resetToken) {
      document.getElementById("authView").style.display = "block";
      document.getElementById("dashboardView").style.display = "none";
      document.querySelector("#accountModal .auth-tabs").style.display = "none";
      document.getElementById("loginForm").style.display = "none";
      document.getElementById("registerForm").style.display = "none";
      document.getElementById("forgotForm").style.display = "none";
      document.getElementById("resetPasswordForm").style.display = "block";
      openModal();
      history.replaceState({}, "", "/");
    } else {
      checkAuth({ openIfLoggedIn: paymentStatus === "success" });
      if (paymentStatus === "success") history.replaceState({}, "", "/");
    }
  }

  initAccountModal();
