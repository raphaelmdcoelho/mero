/* ---------------------------------------------------------------
   i18n.js — lightweight multi-language module
   Supported locales: 'en' (default), 'pt-BR'
   Usage:
     t('key')           → translated string
     t('key', {n: 5})   → with variable substitution
     i18n.setLang('pt-BR')  → switch language (reloads page)
     i18n.getLang()     → current language code
--------------------------------------------------------------- */
(function () {

  // ── Locale dictionaries ────────────────────────────────────────

  const LOCALES = {

    en: {
      // Auth page
      'auth.tagline':            'An idle adventure awaits…',
      'auth.tab.login':          'Login',
      'auth.tab.register':       'Register',
      'auth.username':           'Username',
      'auth.username_hint':      '(3–20 alphanumeric)',
      'auth.password':           'Password',
      'auth.password_hint':      '(min 6 chars)',
      'auth.confirm_password':   'Confirm Password',
      'auth.enter_realm':        'Enter the Realm',
      'auth.create_account':     'Create Account',
      'auth.footer':             'Mero © 2024 — A browser idle RPG',
      'auth.hero_placeholder':   'YourHero',
      // Auth JS
      'auth.entering':           'Entering…',
      'auth.creating':           'Creating…',
      'auth.passwords_no_match': 'Passwords do not match',
      'auth.network_error':      'Network error — please try again',
      'auth.login_failed':       'Login failed',
      'auth.register_failed':    'Registration failed',

      // Characters page
      'char.your_heroes':        'Your Heroes',
      'char.new_character':      '+ New Character',
      'char.logout':             'Logout',
      'char.loading':            'Loading…',
      'char.modal_title':        'Forge a New Hero',
      'char.hero_name':          'Hero Name',
      'char.hero_name_ph':       'Name your hero…',
      'char.choose_class':       'Choose Class',
      'char.cancel':             'Cancel',
      'char.create_hero':        'Create Hero',
      'char.class.warrior':      'Warrior',
      'char.class.mage':         'Mage',
      'char.class.rogue':        'Rogue',
      'char.class.cleric':       'Cleric',
      // Characters JS
      'char.no_heroes':          'No Heroes Yet',
      'char.legend':             'Your legend has not yet begun.',
      'char.create_first':       '+ Create Your First Hero',
      'char.in_dungeon':         '🏰 In Dungeon',
      'char.resting':            '🍺 Resting',
      'char.play':               'Play',
      'char.delete':             'Delete',
      'char.delete_confirm':     'Delete "{name}"? This cannot be undone.',
      'char.retired':            '{name} has been retired.',
      'char.cant_delete':        'Could not delete character.',
      'char.forging':            'Forging…',
      'char.ready':              '{name} the {cls} is ready!',
      'char.failed_create':      'Failed to create character',

      // Game page — action squares
      'game.dungeon':            'Dungeons',
      'game.farm':               'Farm',
      'game.tavern':             'Tavern',
      'game.inventory':          'Inventory',
      'game.attributes':         'Attributes',
      'game.equipment':          'Equipment',
      'game.read':               'Read',
      'game.market':             'Market',
      'game.stats':              'Stats',
      'game.castle':             'Castle',
      'game.coming_soon':        'Soon',
      'game.avatar_hint':        'Click to upload',
      'game.heroes_link':        '← Heroes',
      'game.logout':             'Logout',

      // Dungeon modal
      'game.dm.title':           'Select a Dungeon',
      'game.dm.note':            'Defeat 100 monsters, then face the Boss to increase your mastery.',
      'game.dm.cancel':          'Cancel',
      'game.dm.enter':           'Enter Dungeon',
      'dungeon.set1':            'Verdant Wilds',
      'dungeon.set2':            'Volcanic Depths',
      'dungeon.set3':            'Frozen Wastes',
      'dungeon.set4':            'Thunder Peaks',
      'dungeon.set5':            'Void Realm',
      'dungeon.set_locked':      'Unlocks at level {n}',

      // Battle panel
      'game.bp.hero':            '🧙 Hero',
      'game.bp.press_attack':    'Press Attack to begin!',
      'game.bp.stop':            '🚪 Stop Dungeon',

      // Inventory panel
      'game.inv.hint':           'Max 10 slots · Gold border = equipped',

      // Equipment panel
      'game.eq.weapon':          'Weapon',
      'game.eq.armor':           'Armor',
      'game.eq.equip_from':      'Equip from inventory:',

      // Stats panel
      'game.sp.max_hp':          '❤️ Max HP',
      'game.sp.damage':          '⚔️ Damage',
      'game.sp.hit_chance':      '🎯 Hit Chance',
      'game.sp.dodge_chance':    '💨 Dodge Chance',
      'game.sp.defense':         '🛡️ Defense',
      'game.sp.note':            'Stats include equipped gear and attribute bonuses.',

      // Attributes panel
      'game.ap.points':          'Points to Distribute',
      'game.ap.confirm':         'Confirm Allocation',

      // Farm panel
      'game.fp.desc':            'Grow plants to restore HP in dungeons.',
      'game.fp.in_stock':        'In stock:',
      'game.fp.growing':         'Growing:',
      'game.fp.start_growing':   'Start growing:',
      'game.fp.apple_detail':    '5 min · +1 HP',
      'game.fp.carrot_detail':   '9 min · +2 HP',

      // Market panel
      'game.mp.your_gold':       'Your gold',
      'game.mp.desc':            'Sell items and plants for gold. Equipped items cannot be sold.',

      // Game JS — activity badge
      'game.js.level':              'Level {n}',
      'game.js.points_spend_one':   '✨ {n} point to spend',
      'game.js.points_spend_many':  '✨ {n} points to spend',
      'game.js.dungeon_badge':      '🏰 Dungeon Lv.{n}',
      'game.js.farming_badge':      '🌱 Farming',
      'game.js.reading_badge':      '📖 Reading · {mins}m left · {pts}/2 pts',
      'game.js.resting_badge':      '🍺 Resting',

      // Game JS — action square labels (dynamic)
      'game.js.dungeon_lbl':        'Dungeons',
      'game.js.tavern_lbl':         'Tavern',
      'game.js.farm_lbl':           'Farm',
      'game.js.read_lbl':           'Read',
      'game.js.stop_lbl':           'Stop',
      'game.js.stop_farm_lbl':      'Stop Farm',

      // Game JS — toasts & messages
      'game.js.hero_fallen':        'Your hero has fallen! Retreating from the dungeon…',
      'game.js.plant_consumed':     '{icon} A {plant} was consumed to keep you alive!',
      'game.js.reading_done':       '📖 Reading session complete! Check your attribute points.',
      'game.js.resting_start':      'Resting at the tavern…',
      'game.js.activity_stopped':   'Activity stopped.',
      'game.js.entered_dungeon':    'Entered Dungeon Level {n}!',
      'game.js.boss_defeated':      '🏆 Boss defeated! Dungeon mastery is now {n}!',
      'game.js.item_dropped':       '💎 {icon} {name} dropped!',
      'game.js.boss_spawned':       '⚠️ The Boss appears!',
      'game.js.hero_fallen_msg':    'Your hero has fallen! Return to the dungeon to try again.',
      'game.js.left_dungeon':       'You left the dungeon.',
      'game.js.item_equipped':      'Item equipped!',
      'game.js.attrs_updated':      'Attributes updated!',
      'game.js.reading_start':      '📖 Your hero starts reading. +1 attr point every 30 min (max 2).',
      'game.js.farm_unlock':        'Farming unlocks at level 3!',
      'game.js.farm_started':       'Started farming! Plants will grow over time.',
      'game.js.plant_planted':      '{icon} {plant} planted!',
      'game.js.sold_for':           '🪙 Sold for {n}g!',
      'game.js.jpeg_only':          'Only JPEG images are accepted.',
      'game.js.image_size':         'Image must be under 1 MB.',
      'game.js.avatar_updated':     'Avatar updated!',
      'game.js.cant_equip':         'Could not equip item',
      'game.js.cant_attrs':         'Could not allocate points',
      'game.js.cant_sell':          'Could not sell item',
      'game.js.battle_error':       'Battle error',
      'game.js.failed':             'Failed',
      'game.js.failed_stop':        'Failed to stop',
      'game.js.failed_dungeon':     'Failed to enter dungeon',
      'game.js.failed_farm':        'Failed to start farming',
      'game.js.failed_grow':        'Failed to start growing',

      // Game JS — battle log
      'game.js.bl.mastery':         '🏰 Dungeon Lv.{level} — Mastery: {mastery}',
      'game.js.bl.monsters':        '{kills} / 100 monsters',
      'game.js.bl.boss_prefix':     '👑 BOSS: ',
      'game.js.bl.vs':              '── vs {monster} ──',
      'game.js.bl.hit_player':      '⚔️ You hit {monster} for {damage} — HP: {hp}/{max}',
      'game.js.bl.miss_player':     '💨 Missed {monster}!',
      'game.js.bl.dodge':           '🌀 Dodged {monster}\'s attack!',
      'game.js.bl.hit_monster':     '💥 {monster} hits you for {damage} — Your HP: {hp}/{max}',

      // Game JS — panels misc
      'game.js.ranged':             '(ranged)',
      'game.js.melee':              '(melee)',
      'game.js.dmg_unit':           'dmg',
      'game.js.def_unit':           'def',
      'game.js.equip_btn':          'Equip',
      'game.js.equipped_check':     '✓ Equipped',
      'game.js.no_equippable':      'No equippable items.',
      'game.js.nothing_harvested':  'Nothing harvested yet.',
      'game.js.no_plants_growing':  'No plants growing.',
      'game.js.ready':              'Ready!',
      'game.js.nothing_to_sell':    'Nothing to sell.',
      'game.js.sell_one':           'Sell 1',
      'game.js.equipped_tag':       'Equipped',

      // Attributes
      'attr.strength':              'Strength',
      'attr.strength_hint':         'Melee damage',
      'attr.dexterity':             'Dexterity',
      'attr.dexterity_hint':        'Hit chance & ranged damage',
      'attr.agility':               'Agility',
      'attr.agility_hint':          'Dodge chance',
      'attr.vitality':              'Vitality',
      'attr.vitality_hint':         'Max HP',
      'attr.intelligence':          'Intelligence',
      'attr.intelligence_hint':     '',
      'attr.focus':                 'Focus',
      'attr.focus_hint':            '',
      'attr.stamina':               'Stamina',
      'attr.stamina_hint':          '',
      'attr.resistance':            'Resistance',
      'attr.resistance_hint':       'Defense',
    },

    // ── Portuguese (Brazil) ──────────────────────────────────────

    'pt-BR': {
      // Auth page
      'auth.tagline':            'Uma aventura idle aguarda…',
      'auth.tab.login':          'Entrar',
      'auth.tab.register':       'Registrar',
      'auth.username':           'Usuário',
      'auth.username_hint':      '(3–20 alfanumérico)',
      'auth.password':           'Senha',
      'auth.password_hint':      '(mín. 6 caracteres)',
      'auth.confirm_password':   'Confirmar Senha',
      'auth.enter_realm':        'Entrar no Reino',
      'auth.create_account':     'Criar Conta',
      'auth.footer':             'Mero © 2024 — Um RPG idle no navegador',
      'auth.hero_placeholder':   'SeuHerói',
      // Auth JS
      'auth.entering':           'Entrando…',
      'auth.creating':           'Criando…',
      'auth.passwords_no_match': 'As senhas não coincidem',
      'auth.network_error':      'Erro de rede — tente novamente',
      'auth.login_failed':       'Falha no login',
      'auth.register_failed':    'Falha no registro',

      // Characters page
      'char.your_heroes':        'Seus Heróis',
      'char.new_character':      '+ Novo Personagem',
      'char.logout':             'Sair',
      'char.loading':            'Carregando…',
      'char.modal_title':        'Forjar um Novo Herói',
      'char.hero_name':          'Nome do Herói',
      'char.hero_name_ph':       'Nome do seu herói…',
      'char.choose_class':       'Escolha a Classe',
      'char.cancel':             'Cancelar',
      'char.create_hero':        'Criar Herói',
      'char.class.warrior':      'Guerreiro',
      'char.class.mage':         'Mago',
      'char.class.rogue':        'Ladino',
      'char.class.cleric':       'Clérigo',
      // Characters JS
      'char.no_heroes':          'Nenhum Herói Ainda',
      'char.legend':             'Sua lenda ainda não começou.',
      'char.create_first':       '+ Crie Seu Primeiro Herói',
      'char.in_dungeon':         '🏰 Na Masmorra',
      'char.resting':            '🍺 Descansando',
      'char.play':               'Jogar',
      'char.delete':             'Excluir',
      'char.delete_confirm':     'Excluir "{name}"? Esta ação não pode ser desfeita.',
      'char.retired':            '{name} foi aposentado.',
      'char.cant_delete':        'Não foi possível excluir o personagem.',
      'char.forging':            'Forjando…',
      'char.ready':              '{name} o {cls} está pronto!',
      'char.failed_create':      'Falha ao criar personagem',

      // Game page — action squares
      'game.dungeon':            'Masmorras',
      'game.farm':               'Fazenda',
      'game.tavern':             'Taverna',
      'game.inventory':          'Inventário',
      'game.attributes':         'Atributos',
      'game.equipment':          'Equipamento',
      'game.read':               'Ler',
      'game.market':             'Mercado',
      'game.stats':              'Estatísticas',
      'game.castle':             'Castelo',
      'game.coming_soon':        'Em breve',
      'game.avatar_hint':        'Clique para enviar',
      'game.heroes_link':        '← Heróis',
      'game.logout':             'Sair',

      // Dungeon modal
      'game.dm.title':           'Selecione uma Masmorra',
      'game.dm.note':            'Derrote 100 monstros e então enfrente o Chefe para aumentar seu domínio.',
      'game.dm.cancel':          'Cancelar',
      'game.dm.enter':           'Entrar na Masmorra',
      'dungeon.set1':            'Selvas Verdejantes',
      'dungeon.set2':            'Profundezas Vulcânicas',
      'dungeon.set3':            'Wasteland Gelado',
      'dungeon.set4':            'Picos do Trovão',
      'dungeon.set5':            'Reino do Vazio',
      'dungeon.set_locked':      'Desbloqueado no nível {n}',

      // Battle panel
      'game.bp.hero':            '🧙 Herói',
      'game.bp.press_attack':    'Pressione Atacar para começar!',
      'game.bp.stop':            '🚪 Sair da Masmorra',

      // Inventory panel
      'game.inv.hint':           'Máx. 10 espaços · Borda dourada = equipado',

      // Equipment panel
      'game.eq.weapon':          'Arma',
      'game.eq.armor':           'Armadura',
      'game.eq.equip_from':      'Equipar do inventário:',

      // Stats panel
      'game.sp.max_hp':          '❤️ HP Máximo',
      'game.sp.damage':          '⚔️ Dano',
      'game.sp.hit_chance':      '🎯 Chance de Acerto',
      'game.sp.dodge_chance':    '💨 Chance de Esquiva',
      'game.sp.defense':         '🛡️ Defesa',
      'game.sp.note':            'Os valores incluem bônus de equipamento e atributos.',

      // Attributes panel
      'game.ap.points':          'Pontos a Distribuir',
      'game.ap.confirm':         'Confirmar Alocação',

      // Farm panel
      'game.fp.desc':            'Cultive plantas para restaurar HP nas masmorras.',
      'game.fp.in_stock':        'Em estoque:',
      'game.fp.growing':         'Crescendo:',
      'game.fp.start_growing':   'Começar a cultivar:',
      'game.fp.apple_detail':    '5 min · +1 HP',
      'game.fp.carrot_detail':   '9 min · +2 HP',

      // Market panel
      'game.mp.your_gold':       'Seu ouro',
      'game.mp.desc':            'Venda itens e plantas por ouro. Itens equipados não podem ser vendidos.',

      // Game JS — activity badge
      'game.js.level':              'Nível {n}',
      'game.js.points_spend_one':   '✨ {n} ponto para gastar',
      'game.js.points_spend_many':  '✨ {n} pontos para gastar',
      'game.js.dungeon_badge':      '🏰 Masmorra Nv.{n}',
      'game.js.farming_badge':      '🌱 Cultivando',
      'game.js.reading_badge':      '📖 Lendo · {mins}m restantes · {pts}/2 pts',
      'game.js.resting_badge':      '🍺 Descansando',

      // Game JS — action square labels (dynamic)
      'game.js.dungeon_lbl':        'Masmorras',
      'game.js.tavern_lbl':         'Taverna',
      'game.js.farm_lbl':           'Fazenda',
      'game.js.read_lbl':           'Ler',
      'game.js.stop_lbl':           'Parar',
      'game.js.stop_farm_lbl':      'Parar Fazenda',

      // Game JS — toasts & messages
      'game.js.hero_fallen':        'Seu herói caiu! Recuando da masmorra…',
      'game.js.plant_consumed':     '{icon} Um(a) {plant} foi consumido(a) para mantê-lo vivo!',
      'game.js.reading_done':       '📖 Sessão de leitura concluída! Verifique seus pontos de atributo.',
      'game.js.resting_start':      'Descansando na taverna…',
      'game.js.activity_stopped':   'Atividade encerrada.',
      'game.js.entered_dungeon':    'Entrou na Masmorra Nível {n}!',
      'game.js.boss_defeated':      '🏆 Chefe derrotado! Domínio da masmorra agora é {n}!',
      'game.js.item_dropped':       '💎 {icon} {name} caiu!',
      'game.js.boss_spawned':       '⚠️ O Chefe aparece!',
      'game.js.hero_fallen_msg':    'Seu herói caiu! Volte à masmorra para tentar novamente.',
      'game.js.left_dungeon':       'Você saiu da masmorra.',
      'game.js.item_equipped':      'Item equipado!',
      'game.js.attrs_updated':      'Atributos atualizados!',
      'game.js.reading_start':      '📖 Seu herói começa a ler. +1 ponto de atributo a cada 30 min (máx. 2).',
      'game.js.farm_unlock':        'A fazenda se desbloqueia no nível 3!',
      'game.js.farm_started':       'Cultivo iniciado! As plantas crescerão com o tempo.',
      'game.js.plant_planted':      '{icon} {plant} plantado(a)!',
      'game.js.sold_for':           '🪙 Vendido por {n}g!',
      'game.js.jpeg_only':          'Apenas imagens JPEG são aceitas.',
      'game.js.image_size':         'A imagem deve ter menos de 1 MB.',
      'game.js.avatar_updated':     'Avatar atualizado!',
      'game.js.cant_equip':         'Não foi possível equipar o item',
      'game.js.cant_attrs':         'Não foi possível alocar pontos',
      'game.js.cant_sell':          'Não foi possível vender o item',
      'game.js.battle_error':       'Erro na batalha',
      'game.js.failed':             'Falhou',
      'game.js.failed_stop':        'Falha ao parar',
      'game.js.failed_dungeon':     'Falha ao entrar na masmorra',
      'game.js.failed_farm':        'Falha ao iniciar o cultivo',
      'game.js.failed_grow':        'Falha ao iniciar o plantio',

      // Game JS — battle log
      'game.js.bl.mastery':         '🏰 Masmorra Nv.{level} — Domínio: {mastery}',
      'game.js.bl.monsters':        '{kills} / 100 monstros',
      'game.js.bl.boss_prefix':     '👑 CHEFE: ',
      'game.js.bl.vs':              '── vs {monster} ──',
      'game.js.bl.hit_player':      '⚔️ Você acertou {monster} por {damage} — HP: {hp}/{max}',
      'game.js.bl.miss_player':     '💨 Errou {monster}!',
      'game.js.bl.dodge':           '🌀 Desviou do ataque de {monster}!',
      'game.js.bl.hit_monster':     '💥 {monster} acertou você por {damage} — Seu HP: {hp}/{max}',

      // Game JS — panels misc
      'game.js.ranged':             '(à distância)',
      'game.js.melee':              '(corpo a corpo)',
      'game.js.dmg_unit':           'dano',
      'game.js.def_unit':           'def',
      'game.js.equip_btn':          'Equipar',
      'game.js.equipped_check':     '✓ Equipado',
      'game.js.no_equippable':      'Nenhum item equipável.',
      'game.js.nothing_harvested':  'Nada colhido ainda.',
      'game.js.no_plants_growing':  'Nenhuma planta crescendo.',
      'game.js.ready':              'Pronto!',
      'game.js.nothing_to_sell':    'Nada para vender.',
      'game.js.sell_one':           'Vender 1',
      'game.js.equipped_tag':       'Equipado',

      // Attributes
      'attr.strength':              'Força',
      'attr.strength_hint':         'Dano corpo a corpo',
      'attr.dexterity':             'Destreza',
      'attr.dexterity_hint':        'Chance de acerto e dano à distância',
      'attr.agility':               'Agilidade',
      'attr.agility_hint':          'Chance de esquiva',
      'attr.vitality':              'Vitalidade',
      'attr.vitality_hint':         'HP máximo',
      'attr.intelligence':          'Inteligência',
      'attr.intelligence_hint':     '',
      'attr.focus':                 'Foco',
      'attr.focus_hint':            '',
      'attr.stamina':               'Vigor',
      'attr.stamina_hint':          '',
      'attr.resistance':            'Resistência',
      'attr.resistance_hint':       'Defesa',
    },
  };

  // ── Core API ───────────────────────────────────────────────────

  const DEFAULT_LANG = 'en';

  function getLang() {
    return localStorage.getItem('mero_lang') || DEFAULT_LANG;
  }

  function setLang(lang) {
    localStorage.setItem('mero_lang', lang);
    location.reload();
  }

  /**
   * Translate a key with optional variable substitution.
   * t('game.js.level', { n: 5 }) → "Level 5"
   */
  function t(key, vars) {
    const lang = getLang();
    const dict = LOCALES[lang] || LOCALES[DEFAULT_LANG];
    let str = (dict && dict[key] !== undefined) ? dict[key] : (LOCALES[DEFAULT_LANG][key] || key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.split('{' + k + '}').join(v);
      }
    }
    return str;
  }

  // ── DOM application ────────────────────────────────────────────

  function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    // Inner HTML (for elements that contain child HTML like <span> hints)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    // Input placeholders
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    // Update <html lang> attribute
    document.documentElement.lang = getLang();
  }

  // ── Language switcher ──────────────────────────────────────────

  function renderLangSwitchers() {
    const lang = getLang();
    document.querySelectorAll('.lang-switcher').forEach(el => {
      el.innerHTML =
        `<button class="lang-btn${lang === 'en' ? ' active' : ''}" onclick="i18n.setLang('en')" title="English">EN</button>` +
        `<button class="lang-btn${lang === 'pt-BR' ? ' active' : ''}" onclick="i18n.setLang('pt-BR')" title="Português (BR)">PT</button>`;
    });
  }

  // ── Expose globally ────────────────────────────────────────────

  window.i18n = { getLang, setLang, t };
  window.t    = t;   // shorthand

  document.addEventListener('DOMContentLoaded', function () {
    applyTranslations();
    renderLangSwitchers();
  });

})();
