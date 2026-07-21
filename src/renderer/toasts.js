function setStatus(text, mode = "info") {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.className = mode;

  // Log to notifications system (exclude trivial/empty ready status messages)
  if (text && text !== "Ready" && text !== "Ready.") {
    pushNotification(mode, text);
  }
}

function pushNotification(type, message) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const notification = {
    id: Math.random().toString(36).substr(2, 9),
    type,
    message,
    timestamp
  };
  state.notifications.push(notification);

  // Update badge count if history modal is not open
  const modalOpen = el.notificationsModal && !el.notificationsModal.classList.contains("hidden");
  if (!modalOpen) {
    state.unreadNotificationsCount += 1;
    updateNotificationBadge();
  }

  // Draw toast in the toast container
  if (el.toastContainer) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.dataset.id = notification.id;

    // Truncate message for small toast block
    const displayMsg = message.length > 120 ? `${message.slice(0, 120)}...` : message;

    toast.innerHTML = `
      <span style="font-weight:700; text-transform:uppercase; font-size:0.7rem; margin-right:4px;">${type === "ok" ? "success" : type}:</span>
      <span class="toast-msg">${displayMsg}</span>
      <button class="toast-close" type="button">×</button>
    `;

    // Close button click
    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", () => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      setTimeout(() => toast.remove(), 200);
    });

    el.toastContainer.appendChild(toast);

    // Auto-dismiss info or ok logs after 6 seconds
    if (type === "info" || type === "ok") {
      setTimeout(() => {
        if (toast.parentNode) {
          toast.style.opacity = "0";
          toast.style.transform = "translateX(100%)";
          setTimeout(() => toast.remove(), 200);
        }
      }, 6000);
    }
  }
}

function updateNotificationBadge() {
  if (!el.notificationBadge) return;
  if (state.unreadNotificationsCount > 0) {
    el.notificationBadge.textContent = state.unreadNotificationsCount;
    el.notificationBadge.classList.remove("hidden");
  } else {
    el.notificationBadge.classList.add("hidden");
  }
}

function openNotificationsModal() {
  if (!el.notificationsModal) return;
  el.notificationsModal.classList.remove("hidden");
  
  // Mark all as read
  state.unreadNotificationsCount = 0;
  updateNotificationBadge();
  
  renderNotificationsList();
}

function closeNotificationsModal() {
  if (!el.notificationsModal) return;
  el.notificationsModal.classList.add("hidden");
}

function clearNotifications() {
  state.notifications = [];
  state.unreadNotificationsCount = 0;
  updateNotificationBadge();
  renderNotificationsList();
}

function renderNotificationsList() {
  if (!el.notificationsList) return;
  el.notificationsList.innerHTML = "";

  if (state.notifications.length === 0) {
    el.notificationsList.innerHTML = `<p class="no-logs" style="color:var(--muted); font-size:0.8rem; padding: 20px; text-align:center;">No alerts logged yet.</p>`;
    return;
  }

  // Render logs in reverse order (newest first)
  const sortedLogs = state.notifications.slice().reverse();
  sortedLogs.forEach((item) => {
    const card = document.createElement("div");
    card.className = `notification-history-item ${item.type}`;
    card.innerHTML = `
      <span class="notification-time">${item.timestamp}</span>
      <span class="notification-msg">
        <strong style="text-transform:uppercase; font-size:0.75rem; color:var(--text); display:inline-block; margin-right:4px;">${item.type === "ok" ? "success" : item.type}:</strong>
        ${item.message}
      </span>
    `;
    el.notificationsList.appendChild(card);
  });
}
