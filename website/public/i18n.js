// Lightweight, dependency-free i18n for the public site. No build step, no
// framework — a flat dictionary + data-i18n attributes, matching how the
// rest of this vanilla-JS site already works. English is the default;
// Dutch is a switcher option, persisted in localStorage (not browser-locale
// auto-detection — the product requirement is "English default, Dutch as
// an explicit second option," not "guess the visitor's locale").
(function (global) {
  const STORAGE_KEY = "br_lang";

  const TRANSLATIONS = {
    en: {
      "meta.title": "BromeoRemote | Professional Remote Desktop Software",
      "meta.description": "BromeoRemote — professional remote desktop software for Windows and Android. Secure, fast and protected with HWID licensing and end-to-end encryption.",
      "meta.ogTitle": "BromeoRemote | Professional Remote Desktop Software",
      "meta.ogDescription": "Securely view, control and transfer files across Windows and Android. Enterprise-grade security with HWID and end-to-end encryption.",

      "nav.ariaLabel": "Main navigation",
      "nav.howItWorks": "How it works",
      "nav.security": "Security",
      "nav.pricing": "Pricing",
      "nav.contact": "Contact",
      "header.dashboard": "Dashboard",
      "header.myAccount": "My Account",
      "header.downloadFree": "Download free",

      "hero.eyebrow": "Remote Desktop for Windows & Android",
      "hero.title": "Professional remote support, secured from hardware to session.",
      "hero.lead": "BromeoRemote gives IT professionals and support teams full control: view, control, chat and transfer files — protected by end-to-end encryption and HWID licensing.",
      "hero.ctaPrimary": "Download free",
      "hero.ctaSecondary": "View plans",
      "hero.checksLabel": "Key benefits",
      "hero.check1": "End-to-end encrypted",
      "hero.check2": "HWID hardware binding",
      "hero.check3": "Windows & Android",
      "hero.productAlt": "BromeoRemote interface preview",

      "downloads.eyebrow": "Downloads",
      "downloads.title": "Get started right away.",
      "downloads.subtitle": "Free to download. Upgrade to Professional when you're ready.",
      "downloads.windowsLabel": "Windows",
      "downloads.windowsCta": "Download installer",
      "downloads.portableLabel": "Portable",
      "downloads.portableCta": "Run instantly",
      "downloads.androidLabel": "Android",
      "downloads.androidCta": "Mobile app",

      "workflow.eyebrow": "How it works",
      "workflow.title": "From download to active session in three steps.",
      "workflow.subtitle": "End users just open the app and share their code. The IT admin has full control over session permissions and tools.",
      "workflow.step1Title": "Open BromeoRemote",
      "workflow.step1Body": "The user opens the app and immediately sees a unique device ID and temporary session password.",
      "workflow.step2Title": "Connect with ID & password",
      "workflow.step2Body": "The admin enters the ID and password and chooses the desired session permissions: view, control, or both.",
      "workflow.step3Title": "Solve the problem",
      "workflow.step3Body": "Chat, transfer files, share the clipboard, record the screen and manage the device — all in one session.",

      "features.eyebrow": "What you get",
      "features.title": "Everything a professional support team needs.",
      "features.subtitle": "Built for daily use: connect fast, take over securely, and give users confidence.",
      "features.f1Title": "Full screen, full control",
      "features.f1Body": "View and control Windows PCs with mouse, keyboard and multi-monitor support. View-only available wherever needed.",
      "features.f2Title": "Built-in session tools",
      "features.f2Body": "Chat, file transfer, clipboard, screen recording and restart — instantly available, no extra software needed.",
      "features.f3Title": "Android app for on the go",
      "features.f3Body": "Manage remotely from your smartphone. Touch and mouse mode, light mode and instant notifications included.",
      "features.f4Title": "Unattended access with 2FA",
      "features.f4Body": "Set a fixed password for automatic unattended management, secured with two-factor authentication.",

      "security.eyebrow": "Enterprise Security",
      "security.title": "Security that goes beyond a password.",
      "security.subtitle": "Every layer of BromeoRemote is designed with security first — from the connection to the license.",
      "security.s1Title": "End-to-End Encryption",
      "security.s1Body": "All sessions, chat messages and file transfers are fully encrypted. No one can look in.",
      "security.s2Title": "Granular session permissions",
      "security.s2Body": "Mouse, keyboard, clipboard and files can be allowed or blocked separately per connection.",
      "security.s3Title": "GDPR & Privacy Proof",
      "security.s3Body": "We don't store session content and don't share data with third parties. You stay in full control.",
      "security.s4Title": "HWID License Binding",
      "security.s4Body": "Your license is bound to your PC's hardware fingerprint. Unauthorized use is technically impossible.",

      "pricing.eyebrow": "Licenses & Pricing",
      "pricing.title": "Choose the plan that fits you.",
      "pricing.subtitle": "Pay securely via Mollie (iDEAL, Credit card, PayPal, Apple Pay, Google Pay, SEPA). Your license is active immediately after payment.",
      "pricing.acceptedMethods": "Accepted payment methods:",
      "pricing.illustrationAlt": "Secure license key",
      "pricing.free.title": "Free",
      "pricing.free.desc": "Download for free with basic functionality.",
      "pricing.free.f1": "Remote control & viewing",
      "pricing.free.f2": "Max. 15 min per session",
      "pricing.free.f3": "Standard picture quality",
      "pricing.free.cta": "Download Free",
      "pricing.pro.badge": "Popular",
      "pricing.pro.title": "Pro",
      "pricing.pro.desc": "For the active user and IT admin.",
      "pricing.pro.f1": "Unlimited session duration",
      "pricing.pro.f2": "File transfer & chat",
      "pricing.pro.f3": "HWID hardware security",
      "pricing.pro.f4": "Multi-monitor & curtain mode",
      "pricing.pro.cta": "Subscribe",
      "pricing.unlimited.title": "Unlimited",
      "pricing.unlimited.desc": "For businesses and power users.",
      "pricing.unlimited.f1": "Unlimited devices & sessions",
      "pricing.unlimited.f2": "AI Buddy assistant built in",
      "pricing.unlimited.f3": "Unattended access with 2FA",
      "pricing.unlimited.f4": "Priority support",
      "pricing.unlimited.cta": "Subscribe",

      "faq.eyebrow": "FAQ",
      "faq.title": "Frequently asked questions.",
      "faq.q1": "Is BromeoRemote an alternative to TeamViewer?",
      "faq.a1": "Yes. BromeoRemote offers the same core functionality — remote support, viewing, controlling, chatting and transferring files — but with better privacy, HWID security and transparent pricing with no hidden costs.",
      "faq.q2": "What is HWID and why is it more secure?",
      "faq.a2": "HWID (Hardware ID) binds your license to a unique, irreversible fingerprint of your admin computer. Even if someone got hold of your login details, the license couldn't be used on another PC.",
      "faq.q3": "How do I pay and when is my license active?",
      "faq.a3": "You pay securely via Mollie (iDEAL, Credit card, PayPal, Apple Pay, Google Pay or SEPA). Your license is activated automatically as soon as payment is confirmed — no manual step needed.",
      "faq.q4": "Does BromeoRemote work on all Windows versions?",
      "faq.a4": "BromeoRemote supports Windows 10 and newer. The Android app requires Android 8.0 or higher. A stable internet connection is required for remote sessions.",

      "contact.eyebrow": "Contact",
      "contact.title": "Questions about licenses or business use?",
      "contact.subtitle": "Send a message and we'll get back to you as soon as possible.",
      "contact.name": "Name",
      "contact.email": "Email",
      "contact.company": "Company",
      "contact.subject": "Subject",
      "contact.message": "Message",
      "contact.submit": "Send message",
      "contact.sending": "Sending message...",
      "contact.success": "Thanks, your message has been sent.",
      "contact.genericError": "Request failed.",

      "newsletter.title": "Stay in the loop",
      "newsletter.subtitle": "Get notified about new releases, features and security updates.",
      "newsletter.email": "Email",
      "newsletter.submit": "Subscribe",
      "newsletter.sending": "Saving subscription...",
      "newsletter.success": "You're on the release list.",

      "footer.tagline": "Professional remote desktop software for Windows & Android. Secured with HWID licensing and End-to-End encryption.",
      "footer.company": 'A product of <a href="https://TheGateKeeperEnterprises.com" target="_blank" rel="noopener" style="color:#94a3b8; text-decoration:underline;">The Gatekeeper Enterprises</a>.',
      "footer.chip1": "🔒 End-to-End Encrypted",
      "footer.chip2": "🇪🇺 EU Datacenters & AVG",
      "footer.colProduct": "Product",
      "footer.linkWorkflow": "How it works",
      "footer.linkSecurity": "Security & HWID",
      "footer.linkPricing": "Pricing & Licenses",
      "footer.linkDownloads": "Downloads",
      "footer.linkDashboard": "My Account / Dashboard",
      "footer.colLegal": "Legal & Privacy",
      "footer.privacy": "Privacy Policy",
      "footer.terms": "Terms of Service",
      "footer.linkCookies": "Cookie Policy",
      "footer.colSupport": "Support",
      "footer.contact": "Contact",
      "footer.linkFaq": "Frequently Asked Questions",
      "footer.copyright": '© 2026 BromeoRemote (<a href="https://TheGateKeeperEnterprises.com" target="_blank" rel="noopener" style="color:#94a3b8; text-decoration:underline;">The Gatekeeper Enterprises</a>). All rights reserved.',

      "downloadModal.close": "Close window",
      "downloadModal.chip": "Start free instantly",
      "downloadModal.title": "Download BromeoRemote",
      "downloadModal.subtitle": "Choose your platform below. Free for personal and business testing.",
      "downloadModal.windowsTag": "Recommended",
      "downloadModal.windowsTitle": "Windows Installer",
      "downloadModal.windowsDesc": "With automatic updates & shortcut (.exe installer)",
      "downloadModal.windowsCta": "Download installer",
      "downloadModal.portableTitle": "Windows Portable",
      "downloadModal.portableDesc": "Run instantly without installing (.exe standalone)",
      "downloadModal.portableCta": "Run instantly",
      "downloadModal.androidTag": "Android App",
      "downloadModal.androidTitle": "Android App",
      "downloadModal.androidDesc": "For phones and tablets (.apk mobile app)",
      "downloadModal.androidCta": "Mobile app",
      "downloadModal.footer1": "🔒 End-to-end encrypted",
      "downloadModal.footer2": "🛡️ 100% Virus-free",
      "downloadModal.footer3": "⚡ No registration required",

      "accountModal.title": "My BromeoRemote Account",
      "accountModal.subtitle": "Sign in or create a free account to view and manage your license key.",
      "accountModal.tabLogin": "Sign in",
      "accountModal.tabRegister": "Create account (free)",
      "login.email": "Email address",
      "login.password": "Password",
      "login.submit": "Sign in",
      "login.forgotLink": "Forgot password?",
      "login.genericError": "Sign in failed.",
      "forgot.subtitle": "Enter your email address and we'll send you a link to reset your password.",
      "forgot.email": "Email address",
      "forgot.submit": "Send reset link",
      "forgot.success": "If this email address is known, a reset link has been sent.",
      "forgot.backLink": "Back to sign in",
      "reset.label": "New password (min. 6 characters)",
      "reset.submit": "Set password",
      "reset.success": "Password set! You can now sign in.",
      "reset.genericError": "Setting password failed.",
      "register.email": "Email address *",
      "register.company": "Company name (optional)",
      "register.password": "Password (min. 6 characters) *",
      "register.submit": "Create free account",
      "register.genericError": "Registration failed.",
      "common.serverError": "Server error. Please try again.",
      "common.perMonth": "/mo",

      "dashboard.loggedInAs": "Signed in as:",
      "dashboard.logout": "Sign out",
      "dashboard.licenseTitle": "My License Key",
      "dashboard.licenseSubtitle": "Enter this email address and the license key below into the BromeoRemote software to activate your license and features.",
      "dashboard.licenseKeyLabel": "License key",
      "dashboard.licenseKeyLoading": "Loading...",
      "dashboard.licenseKeyMissing": "No license found",
      "dashboard.copyBtn": "Copy",
      "dashboard.copySuccess": "License key copied to clipboard!",
      "dashboard.newKeyBtn": "New key",
      "dashboard.newKeyConfirm": "Are you sure you want to generate a new license key? Your current key will stop working.",
      "dashboard.newKeyError": "Generating key failed.",
      "dashboard.expiresPermanent": "Permanent free license",
      "dashboard.expiresActive": "Active subscription",
      "dashboard.expiresUntil": "Valid until {{date}}",
      "dashboard.cancelSub": "Cancel subscription",
      "dashboard.cancelSubConfirm": "Are you sure you want to cancel your subscription? Your account will immediately return to the free plan.",
      "dashboard.cancelSubError": "Cancelling failed.",
      "dashboard.upgradeTitle": "Upgrade License",
      "dashboard.upgradeSubtitle": "The software is free by default. Upgrade for unlimited session duration or extra features like AI Buddy.",
      "dashboard.plan.currentBadge": "Current / Basic",
      "dashboard.plan.freeName": "Free",
      "dashboard.plan.f1": "Remote desktop control",
      "dashboard.plan.f2": "Max. 15 min per session",
      "dashboard.plan.f3": "Standard picture quality",
      "dashboard.plan.popularBadge": "Most Chosen",
      "dashboard.plan.proName": "Pro",
      "dashboard.plan.proF1": "Unlimited session duration",
      "dashboard.plan.proF2": "File transfer & Chat",
      "dashboard.plan.proF3": "HWID Hardware security",
      "dashboard.plan.proF4": "Multi-monitor & curtain mode",
      "dashboard.plan.proCta": "Upgrade to Pro",
      "dashboard.plan.unlimitedBadge": "Unlimited",
      "dashboard.plan.unlimitedName": "Unlimited",
      "dashboard.plan.unlimitedF1": "Unlimited devices & sessions",
      "dashboard.plan.unlimitedF2": "AI Buddy assistant built in",
      "dashboard.plan.unlimitedF3": "Unattended access with 2FA",
      "dashboard.plan.unlimitedF4": "Priority support",
      "dashboard.plan.unlimitedCta": "Upgrade to Unlimited",
      "dashboard.checkoutError": "Starting payment failed.",
      "dashboard.instructionsTitle": "💡 How do you activate the license in the BromeoRemote software?",
      "dashboard.instructions1": "Open the BromeoRemote software on your computer.",
      "dashboard.instructions2Pre": "Go to the ",
      "dashboard.instructions2Bold": "Settings / License",
      "dashboard.instructions2Post": " page in the menu.",
      "dashboard.instructions3Pre": "Enter your email address (",
      "dashboard.instructions3Mid": ") and your ",
      "dashboard.instructions3Bold": "License Key",
      "dashboard.instructions3Post": ".",
      "dashboard.instructions4Pre": "Click ",
      "dashboard.instructions4Bold": "Check & Activate License",
      "dashboard.instructions4Post": ". Features and session duration unlock instantly!",
    },
    nl: {
      "meta.title": "BromeoRemote | Professionele Remote Desktop Software",
      "meta.description": "BromeoRemote — professionele remote desktop software voor Windows en Android. Veilig, snel en beveiligd met HWID-licenties en end-to-end encryptie.",
      "meta.ogTitle": "BromeoRemote | Professionele Remote Desktop Software",
      "meta.ogDescription": "Veilig meekijken, besturen en bestanden overzetten via Windows en Android. Enterprise-grade beveiliging met HWID en end-to-end encryptie.",

      "nav.ariaLabel": "Hoofdnavigatie",
      "nav.howItWorks": "Hoe het werkt",
      "nav.security": "Beveiliging",
      "nav.pricing": "Prijzen",
      "nav.contact": "Contact",
      "header.dashboard": "Dashboard",
      "header.myAccount": "Mijn Account",
      "header.downloadFree": "Download gratis",

      "hero.eyebrow": "Remote Desktop voor Windows & Android",
      "hero.title": "Professionele remote support, beveiligd van hardware tot sessie.",
      "hero.lead": "BromeoRemote geeft IT-professionals en supportteams volledige controle: meekijken, besturen, chatten en bestanden overzetten — beschermd door end-to-end encryptie en HWID-licenties.",
      "hero.ctaPrimary": "Gratis downloaden",
      "hero.ctaSecondary": "Bekijk licenties",
      "hero.checksLabel": "Kernvoordelen",
      "hero.check1": "End-to-end versleuteld",
      "hero.check2": "HWID hardware-koppeling",
      "hero.check3": "Windows & Android",
      "hero.productAlt": "BromeoRemote productvoorbeeld",

      "downloads.eyebrow": "Downloads",
      "downloads.title": "Direct aan de slag.",
      "downloads.subtitle": "Gratis te downloaden. Upgrade naar Professional wanneer je klaar bent.",
      "downloads.windowsLabel": "Windows",
      "downloads.windowsCta": "Installer downloaden",
      "downloads.portableLabel": "Portable",
      "downloads.portableCta": "Direct starten",
      "downloads.androidLabel": "Android",
      "downloads.androidCta": "Mobiele app",

      "workflow.eyebrow": "Hoe het werkt",
      "workflow.title": "Van download naar actieve sessie in drie stappen.",
      "workflow.subtitle": "Eindgebruikers hoeven alleen de app te openen en hun code te delen. De IT-beheerder heeft volledige controle over sessierechten en tools.",
      "workflow.step1Title": "Open BromeoRemote",
      "workflow.step1Body": "De gebruiker opent de app en ziet direct een uniek apparaat-ID en tijdelijk sessiewachtwoord.",
      "workflow.step2Title": "Verbind met ID & wachtwoord",
      "workflow.step2Body": "De beheerder voert het ID en wachtwoord in en kiest de gewenste sessierechten: meekijken, besturen of allebei.",
      "workflow.step3Title": "Los het probleem op",
      "workflow.step3Body": "Chat, bestanden overzetten, klembord delen, scherm opnemen en beheeracties — alles in één sessie.",

      "features.eyebrow": "Wat je krijgt",
      "features.title": "Alles wat een professioneel supportteam nodig heeft.",
      "features.subtitle": "Gebouwd voor dagelijks gebruik: snel verbinden, veilig overnemen en gebruikers vertrouwen geven.",
      "features.f1Title": "Volledig scherm, volledige controle",
      "features.f1Body": "Bekijk en bestuur Windows-pc's met muis, toetsenbord en multi-monitor ondersteuning. View-only beschikbaar waar gewenst.",
      "features.f2Title": "Ingebouwde sessietools",
      "features.f2Body": "Chat, bestandsoverdracht, klembord, schermopname en herstart — direct bereikbaar zonder extra software.",
      "features.f3Title": "Android app voor onderweg",
      "features.f3Body": "Beheer op afstand via je smartphone. Touch- en muismodus, lichte modus en snelle notificaties inbegrepen.",
      "features.f4Title": "Onbeheerde toegang met 2FA",
      "features.f4Body": "Stel een vast wachtwoord in voor automatisch beheer zonder aanwezigheid, beveiligd met twee-factor-authenticatie.",

      "security.eyebrow": "Enterprise Beveiliging",
      "security.title": "Veiligheid die verder gaat dan een wachtwoord.",
      "security.subtitle": "Elke laag van BromeoRemote is ontworpen met veiligheid als uitgangspunt — van de verbinding tot de licentie.",
      "security.s1Title": "End-to-End Encryptie",
      "security.s1Body": "Alle sessies, chatberichten en bestandsoverdrachten zijn volledig versleuteld. Niemand kan meekijken.",
      "security.s2Title": "Granulaire sessierechten",
      "security.s2Body": "Muis, toetsenbord, klembord en bestanden kunnen per verbinding apart worden toegestaan of geblokkeerd.",
      "security.s3Title": "AVG & Privacy Proof",
      "security.s3Body": "Wij slaan geen sessie-inhoud op en delen geen gegevens met derden. Jij behoudt de volledige controle.",
      "security.s4Title": "HWID Licentie-koppeling",
      "security.s4Body": "Je licentie is gebonden aan de hardware-vingerafdruk van jouw pc. Ongeautoriseerd gebruik is technisch onmogelijk.",

      "pricing.eyebrow": "Licenties & Prijzen",
      "pricing.title": "Kies het plan dat bij jou past.",
      "pricing.subtitle": "Veilig betalen via Mollie (iDEAL, Creditcard, PayPal, Apple Pay, Google Pay, SEPA). Je licentie is direct actief na betaling.",
      "pricing.acceptedMethods": "Geaccepteerde betaalmethodes:",
      "pricing.illustrationAlt": "Beveiligde licentiesleutel",
      "pricing.free.title": "Gratis",
      "pricing.free.desc": "Download gratis met basis functionaliteit.",
      "pricing.free.f1": "Remote control & meekijken",
      "pricing.free.f2": "Max. 15 min per sessie",
      "pricing.free.f3": "Standaard beeldkwaliteit",
      "pricing.free.cta": "Gratis Downloaden",
      "pricing.pro.badge": "Populair",
      "pricing.pro.title": "Pro",
      "pricing.pro.desc": "Voor de actieve gebruiker en IT-beheerder.",
      "pricing.pro.f1": "Onbeperkte sessieduur",
      "pricing.pro.f2": "Bestandsoverdracht & chat",
      "pricing.pro.f3": "HWID hardware-beveiliging",
      "pricing.pro.f4": "Multi-monitor & gordijnmodus",
      "pricing.pro.cta": "Abonneren",
      "pricing.unlimited.title": "Unlimited",
      "pricing.unlimited.desc": "Voor bedrijven en power-users.",
      "pricing.unlimited.f1": "Onbeperkt apparaten & sessies",
      "pricing.unlimited.f2": "AI Buddy assistent ingebouwd",
      "pricing.unlimited.f3": "Onbeheerde toegang met 2FA",
      "pricing.unlimited.f4": "Prioriteitsondersteuning",
      "pricing.unlimited.cta": "Abonneren",

      "faq.eyebrow": "FAQ",
      "faq.title": "Veelgestelde vragen.",
      "faq.q1": "Is BromeoRemote een alternatief voor TeamViewer?",
      "faq.a1": "Ja. BromeoRemote biedt dezelfde kernfunctionaliteit — remote support, meekijken, besturen, chatten en bestanden overzetten — maar dan met betere privacy, HWID-beveiliging en transparante prijzen zonder verborgen kosten.",
      "faq.q2": "Wat is HWID en waarom is het veiliger?",
      "faq.a2": "HWID (Hardware ID) koppelt jouw licentie aan een unieke, onomkeerbare vingerafdruk van jouw beheercomputer. Zelfs als iemand je inloggegevens zou bemachtigen, kan de licentie niet op een andere pc worden gebruikt.",
      "faq.q3": "Hoe betaal ik en wanneer is mijn licentie actief?",
      "faq.a3": "Je betaalt veilig via Mollie (iDEAL, Creditcard, PayPal, Apple Pay, Google Pay of SEPA). Je licentie wordt automatisch geactiveerd zodra de betaling is bevestigd — geen handmatige stap nodig.",
      "faq.q4": "Werkt BromeoRemote op alle Windows-versies?",
      "faq.a4": "BromeoRemote ondersteunt Windows 10 en nieuwer. De Android app vereist Android 8.0 of hoger. Een stabiele internetverbinding is vereist voor externe sessies.",

      "contact.eyebrow": "Contact",
      "contact.title": "Vragen over licenties of zakelijke inzet?",
      "contact.subtitle": "Stuur een bericht en we komen zo snel mogelijk bij je terug.",
      "contact.name": "Naam",
      "contact.email": "E-mail",
      "contact.company": "Bedrijf",
      "contact.subject": "Onderwerp",
      "contact.message": "Bericht",
      "contact.submit": "Bericht versturen",
      "contact.sending": "Bericht wordt verstuurd...",
      "contact.success": "Bedankt, je bericht is verstuurd.",
      "contact.genericError": "Aanvraag mislukt.",

      "newsletter.title": "Blijf op de hoogte",
      "newsletter.subtitle": "Ontvang een melding bij nieuwe releases, functies en beveiligingsupdates.",
      "newsletter.email": "E-mail",
      "newsletter.submit": "Aanmelden",
      "newsletter.sending": "Aanmelding wordt opgeslagen...",
      "newsletter.success": "Je staat op de release-lijst.",

      "footer.tagline": "Professionele remote desktop software voor Windows & Android. Beveiligd met HWID licenties en End-to-End versleuteling.",
      "footer.company": 'Een product van <a href="https://TheGateKeeperEnterprises.com" target="_blank" rel="noopener" style="color:#94a3b8; text-decoration:underline;">The Gatekeeper Enterprises</a>.',
      "footer.chip1": "🔒 End-to-End Versleuteld",
      "footer.chip2": "🇪🇺 EU Datacenters & AVG",
      "footer.colProduct": "Product",
      "footer.linkWorkflow": "Werkwijze",
      "footer.linkSecurity": "Beveiliging & HWID",
      "footer.linkPricing": "Prijzen & Licenties",
      "footer.linkDownloads": "Downloads",
      "footer.linkDashboard": "Mijn Account / Dashboard",
      "footer.colLegal": "Juridisch & Privacy",
      "footer.privacy": "Privacyverklaring",
      "footer.terms": "Gebruiksvoorwaarden",
      "footer.linkCookies": "Cookiebeleid",
      "footer.colSupport": "Ondersteuning",
      "footer.contact": "Contact opnemen",
      "footer.linkFaq": "Veelgestelde Vragen",
      "footer.copyright": '© 2026 BromeoRemote (<a href="https://TheGateKeeperEnterprises.com" target="_blank" rel="noopener" style="color:#94a3b8; text-decoration:underline;">The Gatekeeper Enterprises</a>). Alle rechten voorbehouden.',

      "downloadModal.close": "Sluit venster",
      "downloadModal.chip": "Direct gratis starten",
      "downloadModal.title": "Download BromeoRemote",
      "downloadModal.subtitle": "Kies je platform hieronder. Gratis voor persoonlijk en zakelijk testen.",
      "downloadModal.windowsTag": "Aanbevolen",
      "downloadModal.windowsTitle": "Windows Installer",
      "downloadModal.windowsDesc": "Met automatische updates & snelkoppeling (.exe installer)",
      "downloadModal.windowsCta": "Installer downloaden",
      "downloadModal.portableTitle": "Windows Portable",
      "downloadModal.portableDesc": "Direct starten zonder installatie (.exe standalone)",
      "downloadModal.portableCta": "Direct starten",
      "downloadModal.androidTag": "Android App",
      "downloadModal.androidTitle": "Android App",
      "downloadModal.androidDesc": "Voor telefoons en tablets (.apk mobiele app)",
      "downloadModal.androidCta": "Mobiele app",
      "downloadModal.footer1": "🔒 End-to-end versleuteld",
      "downloadModal.footer2": "🛡️ 100% Virusvrij",
      "downloadModal.footer3": "⚡ Geen registratie verplicht",

      "accountModal.title": "Mijn BromeoRemote Account",
      "accountModal.subtitle": "Meld je aan of maak een gratis account aan om je licentiesleutel te bekijken en te beheren.",
      "accountModal.tabLogin": "Inloggen",
      "accountModal.tabRegister": "Account Aanmaken (Gratis)",
      "login.email": "E-mailadres",
      "login.password": "Wachtwoord",
      "login.submit": "Inloggen",
      "login.forgotLink": "Wachtwoord vergeten?",
      "login.genericError": "Inloggen mislukt.",
      "forgot.subtitle": "Vul je e-mailadres in, dan sturen we je een link om je wachtwoord opnieuw in te stellen.",
      "forgot.email": "E-mailadres",
      "forgot.submit": "Resetlink versturen",
      "forgot.success": "Als dit e-mailadres bekend is, is er een resetlink verstuurd.",
      "forgot.backLink": "Terug naar inloggen",
      "reset.label": "Nieuw wachtwoord (min. 6 tekens)",
      "reset.submit": "Wachtwoord instellen",
      "reset.success": "Wachtwoord ingesteld! Je kunt nu inloggen.",
      "reset.genericError": "Wachtwoord instellen mislukt.",
      "register.email": "E-mailadres *",
      "register.company": "Bedrijfsnaam (optioneel)",
      "register.password": "Wachtwoord (min. 6 tekens) *",
      "register.submit": "Gratis Account Aanmaken",
      "register.genericError": "Registratie mislukt.",
      "common.serverError": "Serverfout. Probeer opnieuw.",
      "common.perMonth": "/mnd",

      "dashboard.loggedInAs": "Ingelogd als:",
      "dashboard.logout": "Uitloggen",
      "dashboard.licenseTitle": "Mijn Licentiesleutel",
      "dashboard.licenseSubtitle": "Vul dit e-mailadres en onderstaande licentiesleutel in bij de BromeoRemote software om je licentie en functies te activeren.",
      "dashboard.licenseKeyLabel": "Licentiesleutel",
      "dashboard.licenseKeyLoading": "Laden...",
      "dashboard.licenseKeyMissing": "Geen licentie gevonden",
      "dashboard.copyBtn": "Kopiëren",
      "dashboard.copySuccess": "Licentiesleutel gecopieerd naar klembord!",
      "dashboard.newKeyBtn": "Nieuwe sleutel",
      "dashboard.newKeyConfirm": "Weet je zeker dat je een nieuwe licentiesleutel wilt genereren? De huidige sleutel werkt dan niet meer.",
      "dashboard.newKeyError": "Sleutel genereren mislukt.",
      "dashboard.expiresPermanent": "Permanente gratis licentie",
      "dashboard.expiresActive": "Actief abonnement",
      "dashboard.expiresUntil": "Geldig tot {{date}}",
      "dashboard.cancelSub": "Abonnement opzeggen",
      "dashboard.cancelSubConfirm": "Weet je zeker dat je je abonnement wilt opzeggen? Je account gaat direct terug naar het gratis plan.",
      "dashboard.cancelSubError": "Opzeggen mislukt.",
      "dashboard.upgradeTitle": "Licentie Upgraden",
      "dashboard.upgradeSubtitle": "Standaard is de software gratis. Upgrade voor onbeperkte sessieduur of extra functies zoals AI Buddy.",
      "dashboard.plan.currentBadge": "Huidig / Basis",
      "dashboard.plan.freeName": "Gratis",
      "dashboard.plan.f1": "Remote desktop besturing",
      "dashboard.plan.f2": "Max. 15 min per sessie",
      "dashboard.plan.f3": "Standaard beeldkwaliteit",
      "dashboard.plan.popularBadge": "Meest Gekozen",
      "dashboard.plan.proName": "Pro",
      "dashboard.plan.proF1": "Onbeperkte sessieduur",
      "dashboard.plan.proF2": "Bestandsoverdracht & Chat",
      "dashboard.plan.proF3": "HWID Hardware-beveiliging",
      "dashboard.plan.proF4": "Multi-monitor & gordijnmodus",
      "dashboard.plan.proCta": "Upgraden naar Pro",
      "dashboard.plan.unlimitedBadge": "Unlimited",
      "dashboard.plan.unlimitedName": "Unlimited",
      "dashboard.plan.unlimitedF1": "Onbeperkt apparaten & sessies",
      "dashboard.plan.unlimitedF2": "AI Buddy assistent ingebouwd",
      "dashboard.plan.unlimitedF3": "Onbeheerde toegang met 2FA",
      "dashboard.plan.unlimitedF4": "Prioriteitsondersteuning",
      "dashboard.plan.unlimitedCta": "Upgraden naar Unlimited",
      "dashboard.checkoutError": "Betaling starten mislukt.",
      "dashboard.instructionsTitle": "💡 Hoe activeer je de licentie in de BromeoRemote software?",
      "dashboard.instructions1": "Open de BromeoRemote software op je computer.",
      "dashboard.instructions2Pre": "Ga naar de ",
      "dashboard.instructions2Bold": "Instellingen / Licentie",
      "dashboard.instructions2Post": " pagina in het menu.",
      "dashboard.instructions3Pre": "Vul jouw e-mailadres (",
      "dashboard.instructions3Mid": ") en je ",
      "dashboard.instructions3Bold": "Licentiesleutel",
      "dashboard.instructions3Post": " in.",
      "dashboard.instructions4Pre": "Klik op ",
      "dashboard.instructions4Bold": "Licentie Controleren & Activeren",
      "dashboard.instructions4Post": ". De functies en sessieduur worden direct ontgrendeld!",
    },
  };

  function getLang() {
    const stored = global.localStorage.getItem(STORAGE_KEY);
    return stored === "nl" ? "nl" : "en";
  }

  function t(key, vars) {
    const lang = getLang();
    let str = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`{{${k}}}`, "g"), vars[k]);
      });
    }
    return str;
  }

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      el.setAttribute("alt", t(el.getAttribute("data-i18n-alt")));
    });
    const titleTag = document.querySelector("title");
    if (titleTag) titleTag.textContent = t("meta.title");
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", t("meta.description"));
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", t("meta.ogTitle"));
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", t("meta.ogDescription"));
    const activeLang = getLang();
    document.documentElement.lang = activeLang;
    const FLAGS = {
      en: '<svg width="16" height="12" viewBox="0 0 60 30" style="border-radius:2px; flex-shrink:0;"><clipPath id="s_en_c"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="t_en_c"><path d="M30,15 h30 v15 z v-30 h-30 z h-30 v-15 z v30 h30 z"/></clipPath><g clip-path="url(#s_en_c)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="4" clip-path="url(#t_en_c)"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg><span>EN</span>',
      nl: '<svg width="16" height="12" viewBox="0 0 9 6" style="border-radius:2px; flex-shrink:0;"><rect width="9" height="2" fill="#AE1C28"/><rect y="2" width="9" height="2" fill="#FFFFFF"/><rect y="4" width="9" height="2" fill="#21468B"/></svg><span>NL</span>'
    };
    document.querySelectorAll(".lang-current").forEach((el) => {
      el.innerHTML = FLAGS[activeLang] || FLAGS.en;
    });
    document.querySelectorAll("[data-lang-switch]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-lang-switch") === activeLang);
    });
  }

  function setLang(lang) {
    global.localStorage.setItem(STORAGE_KEY, lang === "nl" ? "nl" : "en");
    applyTranslations();
    document.querySelectorAll(".lang-dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    if (global.onLangChange) global.onLangChange();
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".lang-dropdown-trigger");
    const dropdown = e.target.closest(".lang-dropdown");

    if (trigger && dropdown) {
      e.stopPropagation();
      dropdown.classList.toggle("is-open");
      const isOpen = dropdown.classList.contains("is-open");
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    } else {
      document.querySelectorAll(".lang-dropdown.is-open").forEach((d) => {
        d.classList.remove("is-open");
        const trig = d.querySelector(".lang-dropdown-trigger");
        if (trig) trig.setAttribute("aria-expanded", "false");
      });
    }
  });

  global.BromeoI18n = { getLang, setLang, t, applyTranslations };
  document.addEventListener("DOMContentLoaded", applyTranslations);
})(window);
