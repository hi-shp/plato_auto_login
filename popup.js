document.addEventListener("DOMContentLoaded", () => {
    const fields = {
        userId: document.getElementById("userId"),
        userPw: document.getElementById("userPw"),
        popupToggle: document.getElementById("popupToggle"),
        platoPopupClose: document.getElementById("platoPopupClose"),
        hjsId: document.getElementById("hjsId"),
        hjsPw: document.getElementById("hjsPw"),
        hjsToggle: document.getElementById("hjsToggle"),
        hjsPopupClose: document.getElementById("hjsPopupClose"),
        bbitsId: document.getElementById("bbitsId"),
        bbitsPw: document.getElementById("bbitsPw"),
        bbitsToggle: document.getElementById("bbitsToggle"),
        bbitsPopupClose: document.getElementById("bbitsPopupClose"),
        ebookId: document.getElementById("ebookId"),
        ebookPw: document.getElementById("ebookPw"),
        ebookToggle: document.getElementById("ebookToggle"),
        ebookPopupClose: document.getElementById("ebookPopupClose")
    };

    chrome.storage.local.get(Object.keys(fields), (data) => {
        Object.keys(fields).forEach(key => {
            if (!fields[key]) return;
            if (fields[key].type === "checkbox") {
                fields[key].checked = !!data[key];
            } else {
                fields[key].value = data[key] || "";
            }
        });
    });

    const save = () => {
        const saveData = {};
        Object.keys(fields).forEach(key => {
            if (!fields[key]) return;
            saveData[key] = fields[key].type === "checkbox" ? fields[key].checked : fields[key].value;
        });
        chrome.storage.local.set(saveData);
    };

    const showStatus = (checkboxEl) => {
        const statusEl = checkboxEl.closest('.checkbox-group').querySelector('.status-msg');
        if (statusEl) {
            statusEl.classList.add("show");
            setTimeout(() => statusEl.classList.remove("show"), 1000);
        }
    };

    [fields.userId, fields.userPw, fields.hjsId, fields.hjsPw, fields.bbitsId, fields.bbitsPw, fields.ebookId, fields.ebookPw].forEach(el => {
        el?.addEventListener("input", save);
    });

    Object.keys(fields).forEach(key => {
        if (fields[key] && fields[key].type === "checkbox") {
            fields[key].addEventListener("change", () => {
                save();
                showStatus(fields[key]);
            });
        }
    });

    const setupEyeEffect = (btnId, inputEl) => {
        const btn = document.getElementById(btnId);
        if (!btn || !inputEl) return;
        const eyeOn = btn.querySelector(".eye-on");
        const eyeOff = btn.querySelector(".eye-off");
        btn.addEventListener("mouseenter", () => {
            inputEl.type = "text";
            eyeOn.style.display = "block";
            eyeOff.style.display = "none";
        });
        btn.addEventListener("mouseleave", () => {
            inputEl.type = "password";
            eyeOn.style.display = "none";
            eyeOff.style.display = "block";
        });
    };
    setupEyeEffect("togglePlatoPw", fields.userPw);
    setupEyeEffect("toggleHjsPw", fields.hjsPw);
    setupEyeEffect("toggleBbitsPw", fields.bbitsPw);
    setupEyeEffect("toggleEbookPw", fields.ebookPw);

    document.getElementById("githubLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: "https://github.com/hi-shp/plato_auto_login" });
    });
    document.getElementById("webstoreLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: "https://chromewebstore.google.com/detail/plato-%EC%9E%90%EB%8F%99-%EB%A1%9C%EA%B7%B8%EC%9D%B8/alfanhjkmennhlhicpinigkgkifknamm" });
    });
});