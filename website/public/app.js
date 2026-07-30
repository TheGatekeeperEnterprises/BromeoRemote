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
      throw new Error(firstError || BromeoI18n.t("contact.genericError"));
    }
    return payload;
  }

  async function loadSiteConfig() {
    // Keep all download links active and pointing to /download/:platform
  }

  function formatEuro(amount) {
    const locale = BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB";
    return "€" + Number(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Renders the live (admin-configurable) price for one plan into every
  // matching element on the page — the marketing pricing card, its CTA
  // button, and the logged-in dashboard's upgrade card, if present. Shows
  // the original price struck through next to the discounted one while an
  // admin-scheduled discount is currently active (see /api/pricing).
  function renderPlanPrice(plan, info) {
    const priceStr = formatEuro(info.price);
    const effectiveStr = formatEuro(info.effectivePrice);
    const discountActive = Boolean(info.discountActive);

    const amountEl = document.getElementById(`price-amount-${plan}`);
    const originalEl = document.getElementById(`price-original-${plan}`);
    const ctaPriceEl = document.getElementById(`cta-price-${plan}`);
    const dashAmountEl = document.getElementById(`dash-price-amount-${plan}`);
    const dashOriginalEl = document.getElementById(`dash-price-original-${plan}`);
    const dashCtaPriceEl = document.getElementById(`dash-cta-price-${plan}`);

    if (amountEl) amountEl.textContent = discountActive ? effectiveStr : priceStr;
    if (originalEl) {
      originalEl.textContent = priceStr;
      originalEl.hidden = !discountActive;
    }
    if (ctaPriceEl) ctaPriceEl.textContent = discountActive ? effectiveStr : priceStr;
    if (dashAmountEl) dashAmountEl.textContent = discountActive ? effectiveStr : priceStr;
    if (dashOriginalEl) {
      dashOriginalEl.textContent = priceStr;
      dashOriginalEl.hidden = !discountActive;
    }
    if (dashCtaPriceEl) dashCtaPriceEl.textContent = (discountActive ? effectiveStr : priceStr) + "/mo";
  }

  async function loadPricing() {
    try {
      const res = await fetch("/api/pricing");
      const data = await res.json();
      if (!data.ok) return;
      renderPlanPrice("Pro", data.plans.Pro);
      renderPlanPrice("Unlimited", data.plans.Unlimited);
    } catch {
      // Network hiccup — the static fallback prices already in the HTML stay put.
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
        setStatus(contactStatus, BromeoI18n.t("contact.sending"), null);
        await postJson("/api/contact", data);
        contactForm.reset();
        setStatus(contactStatus, BromeoI18n.t("contact.success"), "success");
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
        setStatus(newsletterStatus, BromeoI18n.t("newsletter.sending"), null);
        await postJson("/api/newsletter", data);
        newsletterForm.reset();
        setStatus(newsletterStatus, BromeoI18n.t("newsletter.success"), "success");
      } catch (error) {
        setStatus(newsletterStatus, error.message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  loadSiteConfig();
  loadPricing();

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

      if (trigger) trigger.textContent = BromeoI18n.t("header.myAccount");

      const activeLic = licenses && licenses.length > 0 ? licenses[0] : null;
      if (activeLic) {
        activeLicenseKey = activeLic.license_key;
        document.getElementById("licenseKeyDisplay").textContent = activeLic.license_key;
        document.getElementById("planBadge").textContent = (activeLic.plan || "Free").toUpperCase();
        document.getElementById("cancelSubLink").style.display = activeLic.plan && activeLic.plan !== "Free" ? "inline" : "none";

        if (activeLic.expires_at) {
          const dateLocale = BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB";
          document.getElementById("expiresDisplay").textContent = BromeoI18n.t("dashboard.expiresUntil", {
            date: new Date(activeLic.expires_at).toLocaleDateString(dateLocale),
          });
        } else {
          document.getElementById("expiresDisplay").textContent =
            activeLic.plan === "Free" ? BromeoI18n.t("dashboard.expiresPermanent") : BromeoI18n.t("dashboard.expiresActive");
        }
      } else {
        document.getElementById("licenseKeyDisplay").textContent = BromeoI18n.t("dashboard.licenseKeyMissing");
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
          err.textContent = data.error || BromeoI18n.t("login.genericError");
          err.hidden = false;
        }
      } catch {
        err.textContent = BromeoI18n.t("common.serverError");
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
          err.textContent = data.error || BromeoI18n.t("register.genericError");
          err.hidden = false;
        }
      } catch {
        err.textContent = BromeoI18n.t("common.serverError");
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
        success.textContent = BromeoI18n.t("forgot.success");
        success.hidden = false;
      } catch {
        err.textContent = BromeoI18n.t("common.serverError");
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
          alert(BromeoI18n.t("reset.success"));
          document.getElementById("resetPasswordForm").style.display = "none";
          showTab("login");
        } else {
          err.textContent = data.error || BromeoI18n.t("reset.genericError");
          err.hidden = false;
        }
      } catch {
        err.textContent = BromeoI18n.t("common.serverError");
        err.hidden = false;
      }
    });

    document.getElementById("copyLicenseKeyBtn").addEventListener("click", () => {
      if (!activeLicenseKey) return;
      navigator.clipboard.writeText(activeLicenseKey);
      alert(BromeoI18n.t("dashboard.copySuccess"));
    });

    document.getElementById("regenerateLicenseKeyBtn").addEventListener("click", async () => {
      if (!confirm(BromeoI18n.t("dashboard.newKeyConfirm"))) return;
      try {
        const res = await fetch("/api/user/regenerate-license-key", { method: "POST" });
        const data = await res.json();
        if (data.ok && data.license) {
          activeLicenseKey = data.license.license_key;
          document.getElementById("licenseKeyDisplay").textContent = data.license.license_key;
        } else {
          alert(data.error || BromeoI18n.t("dashboard.newKeyError"));
        }
      } catch {
        alert(BromeoI18n.t("dashboard.newKeyError"));
      }
    });

    document.getElementById("cancelSubLink").addEventListener("click", async () => {
      if (!confirm(BromeoI18n.t("dashboard.cancelSubConfirm"))) return;
      try {
        const res = await fetch("/api/user/cancel-subscription", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          renderDashboard({ email: document.getElementById("userEmailDisplay").textContent }, [data.license]);
        } else {
          alert(data.error || BromeoI18n.t("dashboard.cancelSubError"));
        }
      } catch {
        alert(BromeoI18n.t("dashboard.cancelSubError"));
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
          alert(data.error || BromeoI18n.t("dashboard.checkoutError"));
        }
      } catch {
        alert(BromeoI18n.t("dashboard.checkoutError"));
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
    const openAccount = params.get("account") === "1"; // desktop/mobile app's "Upgraden" link

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
      if (openAccount) {
        openModal();
        history.replaceState({}, "", "/");
      }
    }
  }

  initAccountModal();
