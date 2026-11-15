// Startseite: was heute wichtig ist.
import { state } from '../store.js';
import { $, $$, esc, fmtDate, fmtKm, fmtEur, todayISO, daysUntil, icon } from '../util.js';
import { openDeadlines, dueBilling, billingIsLate, upcomingBirthdays, clientName, activeClients } from '../model.js';
import { view, header, navigate } from '../ui.js';
import { openLogDialog, openDocDialog, openBillingDialog } from '../actions.js';
import { cloudAvailable, cloudConnected, backupNow } from '../cloud.js';
import { openDeadlineDialog, deadlineItemHTML, wireDeadlineItems } from './fristen.js';

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

export function viewToday() {
  header('Heute');
  const s = state.settings;
  const first = (s.ownerName || '').split(' ')[0];
  const deadlines = openDeadlines().filter((d) => daysUntil(d.due) <= 7);
  const billing = dueBilling();
  const birthdays = upcomingBirthdays(14);
  const month = todayISO().slice(0, 7);
  const monthTrips = state.trips.filter((t) => t.date.startsWith(month));
  const monthKm = monthTrips.reduce((a, t) => a + t.km, 0);
  const hasData = state.clients.length || state.trips.length;
  let backupBanner = '';
  if (cloudConnected()) {
    const hours = state.cloud.lastUpload ? (Date.now() - Date.parse(state.cloud.lastUpload)) / 3600000 : Infinity;
    if (hasData && hours > 24) backupBanner = `<div class="banner" style="margin-top:16px">${icon('shield')}
      ${hours === Infinity ? 'Noch keine Sicherung in Google Drive.' : `Letzte Google-Drive-Sicherung vor ${Math.floor(hours / 24)} Tag(en).`}
      <br><button class="btn primary" id="h-cloud">Jetzt in Google Drive sichern</button></div>`;
  } else {
    const backupDays = state.lastBackup ? -daysUntil(state.lastBackup.slice(0, 10)) : null;
    if (hasData && (backupDays == null || backupDays > 30)) backupBanner = `<div class="banner" style="margin-top:16px">${icon('shield')}
      ${backupDays == null ? 'Du hast noch nie eine Sicherung gemacht.' : `Letzte Sicherung vor ${backupDays} Tagen.`}
      Geht das Handy verloren, sind die Daten sonst weg.<br><button class="btn primary" data-nav="sicherung">${cloudAvailable() ? 'Sicherung einrichten' : 'Jetzt sichern'}</button></div>`;
  }

  const setup = [
    !s.home && ['Wohnadresse eintragen', 'einstellungen'],
    !s.ownerName && ['Eigenen Namen eintragen (für Briefe & Export)', 'einstellungen'],
    !activeClients().length && ['Ersten Klienten anlegen', 'klient/neu'],
  ].filter(Boolean);

  view().innerHTML = `
    <div class="hello"><div class="hello-title">${greeting()}${first ? ', ' + esc(first) : ''}</div>
      <div class="muted">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>

    <div class="tiles four">
      <button class="tile" data-go="fahrt">${icon('car')}<span>Fahrt</span></button>
      <button class="tile" data-go="log">${icon('phone')}<span>Kontakt</span></button>
      <button class="tile" data-go="doc">${icon('camera')}<span>Post</span></button>
      <button class="tile" data-go="frist">${icon('clock')}<span>Frist</span></button>
    </div>

    ${setup.length ? `<h2>Einrichten</h2><div class="list">${setup.map(([t, p]) => `
      <button class="item" data-nav="${p}">${icon('plus')}<div class="main"><div class="t1">${t}</div></div><span class="chev">›</span></button>`).join('')}</div>` : ''}

    <h2>Fristen bis nächste Woche ${deadlines.length ? `<span class="count">${deadlines.length}</span>` : ''}</h2>
    ${deadlines.length ? `<div class="list" id="h-dl">${deadlines.map(deadlineItemHTML).join('')}</div>`
      : `<div class="card muted small">Nichts fällig. ${openDeadlines().length ? `Nächste Frist: ${esc(openDeadlines()[0].title)} am ${fmtDate(openDeadlines()[0].due)}.` : ''}</div>`}

    ${billing.length ? `<h2>Vergütung beantragen <span class="count">${billing.length}</span></h2>
      <div class="list">${billing.slice(0, 6).map(({ client, period }) => `
        <button class="item" data-bill="${client.id}|${period.from}">${icon('euro')}
          <div class="main"><div class="t1">${esc(clientName(client))}</div>
          <div class="t2">${fmtDate(period.from)} – ${fmtDate(period.to)}${client.monthlyFee ? ' · ca. ' + fmtEur(client.monthlyFee * 3) : ''}${billingIsLate(period) ? ' · <span class="err">lange offen!</span>' : ''}</div></div>
          <span class="status s-fällig">fällig</span>
        </button>`).join('')}</div>
      ${billing.length > 6 ? `<p class="small muted pad">… und ${billing.length - 6} weitere bei den Klienten.</p>` : ''}` : ''}

    ${birthdays.length ? `<h2>Geburtstage</h2><div class="list">${birthdays.map((b) => `
      <button class="item" data-nav="klient/${b.client.id}">${icon('cake')}
        <div class="main"><div class="t1">${esc(clientName(b.client))} wird ${b.age}</div><div class="t2">${b.days === 0 ? 'heute 🎉' : b.days === 1 ? 'morgen' : `in ${b.days} Tagen`} · ${fmtDate(b.date)}</div></div>
      </button>`).join('')}</div>` : ''}

    <h2>Dieser Monat</h2>
    <button class="stats plain" data-nav="fahrten" style="width:100%">
      <div class="stat"><b>${monthTrips.length}</b><span>Fahrten</span></div>
      <div class="stat"><b>${fmtKm(monthKm)}</b><span>km</span></div>
      <div class="stat"><b>${state.logs.filter((l) => l.date.startsWith(month)).length}</b><span>Kontakte</span></div>
    </button>

    ${backupBanner}
  `;

  const v = view();
  $$('[data-go]', v).forEach((b) => b.onclick = () => ({
    fahrt: () => navigate('fahrt/neu'),
    log: () => openLogDialog(),
    doc: () => openDocDialog(),
    frist: () => openDeadlineDialog(),
  })[b.dataset.go]());
  $$('[data-nav]', v).forEach((b) => b.onclick = () => navigate(b.dataset.nav));
  $$('[data-bill]', v).forEach((b) => b.onclick = () => {
    const [cid, from] = b.dataset.bill.split('|');
    const item = billing.find((x) => x.client.id === cid && x.period.from === from);
    openBillingDialog(item.client, item.period);
  });
  wireDeadlineItems(v);
  $('#h-cloud', v)?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Sichere …';
    backupNow();
  });
}
