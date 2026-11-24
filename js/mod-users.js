/** Manajemen pengguna WMS (khusus Supervisor). */
(function (global) {
  'use strict';
  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;
  var ui = WMS.ui;
  var state = { items: [] };
  var panel;
  var loadGen = 0;

  function template() {
    return '<div class="module-head"><div><p class="eyebrow">Administrasi · Akses</p><h2>Manajemen Pengguna</h2><p class="module-head__desc">Kelola akun, hak gudang, status aktif, dan reset PIN.</p></div><div class="module-head__actions"><button class="btn btn--ghost btn--sm" data-action="refresh">'+ui.ICONS.refresh+' Muat Ulang</button><button class="btn btn--primary btn--sm" data-action="create">+ Tambah Pengguna</button></div></div>'+
      '<div class="card"><div class="card__head"><div><h3>Daftar Pengguna</h3><p>PIN tidak pernah ditampilkan dalam daftar ini.</p></div><span class="pill" id="users-count">0 pengguna</span></div><div class="toolbar">'+ui.searchField('users-search','Cari ID, username, atau nama…')+'</div><div class="table-wrap"><table class="data-table" id="users-table"><thead><tr><th>ID User</th><th>Username</th><th>Nama Lengkap</th><th>Role</th><th>Akses Gudang</th><th>Status</th><th>Last Login</th><th class="actions-cell">Aksi</th></tr></thead><tbody id="users-body">'+ui.tableLoadingRow(8,4)+'</tbody></table></div></div>';
  }
  function render() {
    var body = panel.querySelector('#users-body');
    if (!state.items.length) { body.innerHTML = ui.tableEmptyRow(8,'Belum ada pengguna','Tambahkan akun pengguna untuk mulai.'); return; }
    body.innerHTML = state.items.map(function (u) {
      var search = [u.ID_User,u.Username,u.Nama_Lengkap].join(' ').toLowerCase();
      return '<tr data-row data-search="'+ui.esc(search)+'"><td>'+ui.esc(u.ID_User)+'</td><td><strong>'+ui.esc(u.Username)+'</strong></td><td>'+ui.esc(u.Nama_Lengkap)+'</td><td>'+ui.badge(u.Role)+'</td><td>'+ui.badge(u.Akses_Gudang)+'</td><td>'+ui.badge(u.Status_Aktif)+'</td><td class="nowrap muted">'+ui.esc(ui.formatDateTime(u.Last_Login))+'</td><td class="actions-cell"><button class="btn btn--ghost btn--sm" data-edit="'+ui.esc(u.ID_User)+'">Edit / Reset PIN</button></td></tr>';
    }).join('');
    var count = panel.querySelector('#users-count'); count.textContent = state.items.length+' pengguna';
    ui.filterTable({table:'#users-table',search:'#users-search',count:'#users-count',countLabel:'pengguna'});
  }
  async function load() {
    var gen = ++loadGen;
    if (!panel || !panel.querySelector('#users-body')) return;
    var body = panel.querySelector('#users-body'); body.innerHTML = ui.tableLoadingRow(8,4);
    try { var data = await WMS.api.request('USERS_LIST'); if (gen !== loadGen) return; state.items = data && Array.isArray(data.items) ? data.items : []; render(); }
    catch (e) { if (gen !== loadGen) return; if (WMS.api.isAuthError(e)) return; body.innerHTML=ui.tableErrorRow(8,e.message); ui.bindRetry(body,load); }
  }
  function formMarkup(edit, user) {
    user = user || {};
    function field(label,id,control,full) { return '<div class="field'+(full?' field--full':'')+'"><label for="'+id+'">'+label+'</label>'+control+'</div>'; }
    var common = field('Nama Lengkap','u-name','<input class="input" id="u-name" maxlength="100" required value="'+ui.esc(user.Nama_Lengkap||'')+'">')+
      field('Role','u-role','<select class="select" id="u-role"><option value="STAFF" '+(user.Role==='STAFF'?'selected':'')+'>STAFF</option><option value="SUPERVISOR" '+(user.Role==='SUPERVISOR'?'selected':'')+'>SUPERVISOR</option></select>')+
      field('Akses Gudang','u-access','<select class="select" id="u-access"><option value="EPIC" '+(user.Akses_Gudang==='EPIC'?'selected':'')+'>EPIC</option><option value="GEA" '+(user.Akses_Gudang==='GEA'?'selected':'')+'>GEA</option><option value="ALL" '+(user.Akses_Gudang==='ALL'?'selected':'')+'>ALL</option></select>');
    var fields = edit ? common + field('Status Akun','u-status','<select class="select" id="u-status"><option value="AKTIF" '+(user.Status_Aktif==='AKTIF'?'selected':'')+'>AKTIF</option><option value="NONAKTIF" '+(user.Status_Aktif==='NONAKTIF'?'selected':'')+'>NONAKTIF</option></select>') + field('Reset PIN Baru (opsional)','u-pin','<input class="input" id="u-pin" type="password" minlength="6" autocomplete="new-password" placeholder="Kosongkan jika tidak diubah">',true)
      : field('Username','u-username','<input class="input" id="u-username" required pattern="[a-z0-9][a-z0-9._-]*" maxlength="50" autocomplete="username">') + common + field('PIN Baru','u-pin','<input class="input" id="u-pin" type="password" required minlength="6" autocomplete="new-password">',true);
    return '<form id="users-form" class="form-grid">'+fields+'<div class="form-alert" id="users-error" hidden role="alert"></div></form>';
  }
  function openForm(user) {
    var edit = !!user;
    ui.openModal({eyebrow:'Manajemen Pengguna',title:edit?'Edit Pengguna':'Tambah Pengguna',subtitle:edit?user.Username+' · '+user.ID_User:'Buat akun baru untuk tim gudang.',size:'md',body:formMarkup(edit,user),footer:'<button class="btn btn--ghost" type="button" data-modal-close>Batal</button><button class="btn btn--primary" type="submit" form="users-form" data-submit>Simpan</button>',onMount:function(modal,close){
      var usersForm=modal.querySelector('#users-form');if(!usersForm)return;usersForm.addEventListener('submit',async function(ev){ev.preventDefault();
        var error=modal.querySelector('#users-error'), submit=modal.querySelector('[data-submit]'); error.hidden=true;
        var pin=modal.querySelector('#u-pin').value;
        if(pin && pin.length<6){error.textContent='PIN minimal 6 karakter.';error.hidden=false;return;}
        var payload={};
        if(edit){payload.idUser=user.ID_User;payload.namaLengkap=modal.querySelector('#u-name').value.trim();payload.role=modal.querySelector('#u-role').value;payload.aksesGudang=modal.querySelector('#u-access').value;payload.statusAktif=modal.querySelector('#u-status').value;if(pin)payload.pinHash=await WMS.auth.hashPin(pin);}
        else {payload.username=modal.querySelector('#u-username').value.trim();payload.namaLengkap=modal.querySelector('#u-name').value.trim();payload.role=modal.querySelector('#u-role').value;payload.aksesGudang=modal.querySelector('#u-access').value;payload.pinHash=await WMS.auth.hashPin(pin);}
        submit.disabled=true;submit.textContent='Menyimpan…';
        try{await WMS.api.request(edit?'USERS_UPDATE':'USERS_CREATE',payload);ui.toast(edit?'Data pengguna diperbarui.':'Pengguna berhasil dibuat.','success');close('saved');await load();}
        catch(e){error.textContent=e.message||'Gagal menyimpan pengguna.';error.hidden=false;submit.disabled=false;submit.textContent='Simpan';}
      });
    }});
  }
  function mount(root){panel=root;if(!WMS.auth.isSupervisor()){root.innerHTML='<div class="locked-panel"><h3>Akses Terbatas</h3><p>Manajemen pengguna hanya tersedia untuk Supervisor.</p><button class="btn btn--primary" data-goto="inbound">Kembali ke Inbound</button></div>';return Promise.resolve();}root.innerHTML=template();var refresh=root.querySelector('[data-action="refresh"]'),create=root.querySelector('[data-action="create"]'),body=root.querySelector('#users-body');if(refresh)refresh.onclick=load;if(create)create.onclick=function(){openForm(null);};if(body)body.addEventListener('click',function(e){var b=e.target.closest('[data-edit]');if(b)openForm(state.items.find(function(u){return u.ID_User===b.getAttribute('data-edit');}));});return load();}
  WMS.registerModule({id:'users',label:'Manajemen Pengguna',eyebrow:'Administrasi · Akses',title:'Manajemen Pengguna',description:'Kelola akun pengguna',requiresRole:'SUPERVISOR',mount:mount,refresh:load});
})(window);
