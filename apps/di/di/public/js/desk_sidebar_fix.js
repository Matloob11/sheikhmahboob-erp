(function () {
	const SMC_LOGO_URL = "/assets/di/images/smc-mark.svg";

	function escape(value) {
		if (window.frappe?.utils?.escape_html) {
			return window.frappe.utils.escape_html(value || "");
		}
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function updateSidebarHeaderDOM() {
		const $header = $(".sidebar-header");
		if (!$header.length) return;

		const titleText = $header.find(".header-title").text().trim();
		const route = window.location.pathname;

		if (titleText === "Digital Invoicing" || route.includes("digital-invoicing")) {
			const $logo = $header.find(".header-logo");
			if ($logo.length) {
				const currentImg = $logo.find("img").attr("src");
				if (currentImg !== SMC_LOGO_URL) {
					$logo.html(
						`<img src="${SMC_LOGO_URL}" style="width:100%;height:100%;object-fit:contain;display:block;">`
					);
				}
				$header.find(".sidebar-item-icon").css({
					"background-color": "transparent",
					"display": "flex",
					"align-items": "center",
					"justify-content": "center",
					"padding": "2px",
				});
			}
		}
	}

	function patchSidebarHeaderClass() {
		if (window.frappe?.ui?.SidebarHeader && !frappe.ui.SidebarHeader.prototype.__diSidebarFix) {
			const originalMake = frappe.ui.SidebarHeader.prototype.make;
			frappe.ui.SidebarHeader.prototype.make = function () {
				let desktop_icon = this.get_desktop_icon_by_label(
					this.sidebar?.sidebar_title || this.title
				);
				if (
					this.sidebar?.sidebar_title === "Digital Invoicing" ||
					this.title === "Digital Invoicing" ||
					(desktop_icon && desktop_icon.logo_url)
				) {
					const logoUrl = (desktop_icon && desktop_icon.logo_url) || SMC_LOGO_URL;
					this.header_icon = `<img src="${escape(
						logoUrl
					)}" style="width:100%;height:100%;object-fit:contain;display:block;">`;
				}
				if (originalMake) {
					originalMake.call(this);
				}
				updateSidebarHeaderDOM();
			};

			frappe.ui.SidebarHeader.prototype.add_app_item = function (item) {
				if (!item || item.is_divider || !item.label) {
					return;
				}

				const iconMarkup = item.icon
					? frappe.utils.icon(item.icon)
					: item.icon_html
					? item.icon_html
					: item.icon_url
					? `<img class="logo" src="${escape(item.icon_url)}">`
					: frappe.utils.icon("circle", "sm");

				$(`<div class="dropdown-menu-item" data-name="${escape(item.name || item.label)}"
					data-app-route="${escape(item.route || item.url || "")}">
					<a ${item.href ? `href="${escape(item.href)}"` : ""}>
						<div class="sidebar-item-icon">
							${iconMarkup}
						</div>
						<span class="menu-item-title">${escape(item.label)}</span>
					</a>
				</div>`).appendTo(this.dropdown_menu);
			};

			frappe.ui.SidebarHeader.prototype.__diSidebarFix = true;
		}
	}

	// 1. Polling for class definition
	let attempts = 0;
	const interval = setInterval(function () {
		attempts++;
		patchSidebarHeaderClass();
		updateSidebarHeaderDOM();
		if (attempts > 50) {
			clearInterval(interval);
		}
	}, 100);

	// 2. Frappe router change listener
	if (window.frappe?.router) {
		frappe.router.on("change", function () {
			setTimeout(updateSidebarHeaderDOM, 50);
			setTimeout(updateSidebarHeaderDOM, 200);
		});
	}

	// 3. MutationObserver for DOM changes
	const observer = new MutationObserver(function () {
		updateSidebarHeaderDOM();
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () {
			if (document.body) {
				observer.observe(document.body, { childList: true, subtree: true });
			}
			updateSidebarHeaderDOM();
		});
	} else {
		if (document.body) {
			observer.observe(document.body, { childList: true, subtree: true });
		}
		updateSidebarHeaderDOM();
	}
})();
