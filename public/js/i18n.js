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
      'game.research':           'Research',
      'game.coming_soon':        'Soon',
      'game.avatar_hint':        'Click to change',
      'game.heroes_link':        '← Heroes',
      'game.logout':             'Logout',

      // Avatar picker modal
      'game.apm.title':          'Choose Avatar',
      'game.apm.subtitle':       'Pick a hero portrait or upload your own.',
      'game.apm.or':             'or',
      'game.apm.custom':         '📁 Upload Custom Image',
      'game.apm.cancel':         'Cancel',
      'game.apm.selecting':      'Selecting…',
      'game.apm.preset_labels': {
        iron_knight:    'Iron Knight',
        shield_maiden:  'Shield Maiden',
        arcane_scholar: 'Arcane Scholar',
        storm_witch:    'Storm Witch',
        shadow_blade:   'Shadow Blade',
        night_hunter:   'Night Hunter',
        holy_light:     'Holy Light',
        dawn_keeper:    'Dawn Keeper',
        dragon_blood:   'Dragon Blood',
        forest_spirit:  'Forest Spirit',
      },

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
      // Dungeon names (active dungeons)
      'dungeon.forest':          'Forest',
      'dungeon.autumn_harvest':  'Autumn Harvest',
      'dungeon.murky_swamp':     'Murky Swamp',
      'dungeon.crystal_cave':    'Crystal Cave',
      // Difficulty labels
      'dungeon.choose_diff':     'Choose Difficulty',
      'dungeon.diff.easy':       'Easy',
      'dungeon.diff.medium':     'Medium',
      'dungeon.diff.hard':       'Hard',
      // Potion section
      'dungeon.potion_label':    'Adventure Potion',
      'dungeon.potion_optional': '(optional)',
      'dungeon.none':            'None',
      'dungeon.no_potions':      'No adventure potions to be used',
      // Battle panel misc
      'dungeon.remaining':       'remaining',
      // Loot modal
      'dungeon.collect_close':   'Collect & Close',
      'dungeon.complete':        '🎉 Dungeon Complete!',
      'dungeon.stopped':         '🏃 Dungeon Stopped',
      'dungeon.no_loot':         'No loot this run.',
      // Stamina warnings
      'dungeon.requires_level':  '🔒 Requires level {n} (you are level {lvl})',
      'dungeon.no_stamina':      'Not enough stamina (need {need}, have {have})',
      // Item type labels
      'item.type.weapon':        'weapon',
      'item.type.armor':         'armor',
      'item.type.consumable':    'consumable',
      'item.wtype.melee':        'melee',
      'item.wtype.ranged':       'ranged',
      'item.slot.body':          'body',
      'item.slot.shield':        'shield',
      // Item names
      'item.name.1':             'Wooden Sword',
      'item.name.2':             'Iron Sword',
      'item.name.3':             'Leather Armor',
      'item.name.4':             'Iron Shield',
      'item.name.5':             'Health Potion',
      'item.name.6':             'Carrot',
      'item.name.7':             'Apple',
      'item.name.8':             'Short Bow',
      'item.name.9':             'Steel Sword',
      'item.name.10':            'Chainmail',
      'item.name.11':            'Plate Armor',
      'item.name.12':            'Oak Shield',
      'item.name.13':            'Steel Shield',
      'item.name.14':            'Knight Shield',
      'item.name.15':            'Hunter Jacket',
      'item.name.16':            'War Axe',
      'item.name.17':            'Longbow',
      'item.name.18':            'Guardian Armor',
      'item.name.19':            'Tower Shield',
      'item.name.20':            'Swift Elixir',
      'item.name.21':            'Fortune Brew',
      'item.name.22':            'Abundance Tonic',
      'item.name.23':            'Vitality Draught',
      'item.name.24':            'Wisdom Potion',
      'item.name.25':            'Crimson Blade',
      'item.name.26':            'Harvest Plate',
      'item.name.27':            'Swamp Cleaver',
      'item.name.28':            'Bog Armor',
      // Item descriptions
      'item.desc.1':             'A basic training sword.',
      'item.desc.2':             'A sturdy iron blade.',
      'item.desc.3':             'Light but protective.',
      'item.desc.4':             'Heavy iron shield.',
      'item.desc.5':             'Restores 5 HP.',
      'item.desc.6':             'Restores 2 HP.',
      'item.desc.7':             'Restores 1 HP.',
      'item.desc.8':             'A ranged weapon. Uses Dexterity.',
      'item.desc.9':             'A finely forged steel blade.',
      'item.desc.10':            'Linked metal rings for armor.',
      'item.desc.11':            'Heavy full-body plate armor.',
      'item.desc.12':            'A sturdy oak shield.',
      'item.desc.13':            'Balanced defense with steel ribs.',
      'item.desc.14':            'Towering protection for champions.',
      'item.desc.15':            'Flexible armor for quick skirmish.',
      'item.desc.16':            'A heavy axe built for crushing hits.',
      'item.desc.17':            'High-tension bow with strong pull.',
      'item.desc.18':            'Layered plates for elite guards.',
      'item.desc.19':            'Massive shield with near-wall cover.',
      'item.desc.20':            'Reduces dungeon time by 30%.',
      'item.desc.21':            'Greatly improves dungeon loot quality.',
      'item.desc.22':            'Gain 2 extra loot items from the dungeon.',
      'item.desc.23':            'Restores 1 stamina upon dungeon completion.',
      'item.desc.24':            'Doubles XP gained in the dungeon.',
      'item.desc.25':            'A blade forged from autumn iron.',
      'item.desc.26':            'Sturdy armor crafted from harvest steel.',
      'item.desc.27':            'Heavy cleaver coated in bog resin.',
      'item.desc.28':            'Armor reinforced with hardened swamp scale.',

      // Battle panel
      'game.bp.hero':            '🧙 Hero',
      'game.bp.press_attack':    'Press Attack to begin!',
      'game.bp.stop':            '🚪 Stop Dungeon',

      // Inventory panel
      'game.inv.hint':           'Max 10 slots · Gold border = equipped',

      // Equipment panel
      'game.eq.weapon':          'Weapon',
      'game.eq.armor':           'Armor',
      'game.eq.shield':          'Shield',
      'game.eq.equip_from':      'Equip from inventory:',

      // Stats panel
      'game.sp.title':           '📊 Combat Stats',
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
      'game.fp.start_action':    'Start Farm',
      'game.fp.stop_action':     'Stop Farm',
      'game.fp.idle_status':     'Farm is idle',
      'game.fp.running_status':  'Farm is running',
      'game.fp.busy_other_activity': 'Stop your current activity first',

      // Market panel
      'game.mp.your_gold':       'Your gold',
      'game.mp.desc':            'Sell items and plants for gold. Equipped items cannot be sold.',
      'game.mp.tab_sell':        'Sell',
      'game.mp.tab_buy':         'Buy',
      'game.mp.sell_desc':       'Sell items for gold. Equipped items cannot be sold.',
      'game.mp.buy_desc':        'Browse the shop and purchase items.',

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
      'game.js.empty':              'Empty',
      'game.js.ranged':             '(ranged)',
      'game.js.melee':              '(melee)',
      'game.js.dmg_unit':           'dmg',
      'game.js.def_unit':           'def',
      'game.js.equip_btn':          'Equip',
      'game.js.unequip_btn':        'Unequip',
      'game.js.equipped_check':     '✓ Equipped',
      'game.js.no_equippable':      'No equippable items.',
      'game.js.item_unequipped':    'Item unequipped!',
      'game.js.nothing_harvested':  'Nothing harvested yet.',
      'game.js.no_plants_growing':  'No plants growing.',
      'game.js.ready':              'Ready!',
      'game.js.nothing_to_sell':    'Nothing to sell.',
      'game.js.sell_one':           'Sell 1',
      'game.js.equipped_tag':       'Equipped',
      'game.js.buy_one':            'Buy 1',
      'game.js.cant_buy':           'Could not buy item',
      'game.js.bought_for':         '🪙 Bought for {n}g!',
      'game.js.shop_empty':         'No items available.',
      'game.js.loading':            'Loading…',
      'game.js.qty':                'Qty',
      'game.js.each':               'each',
      'game.js.click_to_sell':      'Click to sell 1',
      'game.js.click_to_buy':       'Click to buy 1',
      'game.js.cant_afford':        'Not enough gold',

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
      'game.research':           'Pesquisa',
      'game.coming_soon':        'Em breve',
      'game.avatar_hint':        'Clique para alterar',
      'game.heroes_link':        '← Heróis',
      'game.logout':             'Sair',

      // Avatar picker modal
      'game.apm.title':          'Escolher Avatar',
      'game.apm.subtitle':       'Escolha um retrato de herói ou envie o seu.',
      'game.apm.or':             'ou',
      'game.apm.custom':         '📁 Enviar Imagem Personalizada',
      'game.apm.cancel':         'Cancelar',
      'game.apm.selecting':      'Selecionando…',
      'game.apm.preset_labels': {
        iron_knight:    'Cavaleiro de Ferro',
        shield_maiden:  'Donzela do Escudo',
        arcane_scholar: 'Erudito Arcano',
        storm_witch:    'Bruxa da Tempestade',
        shadow_blade:   'Lâmina Sombria',
        night_hunter:   'Caçador da Noite',
        holy_light:     'Luz Sagrada',
        dawn_keeper:    'Guardião da Aurora',
        dragon_blood:   'Sangue de Dragão',
        forest_spirit:  'Espírito da Floresta',
      },

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
      // Dungeon names (active dungeons)
      'dungeon.forest':          'Floresta',
      'dungeon.autumn_harvest':  'Colheita de Outono',
      'dungeon.murky_swamp':     'Pântano Sombrio',
      'dungeon.crystal_cave':    'Caverna de Cristal',
      // Difficulty labels
      'dungeon.choose_diff':     'Escolha a Dificuldade',
      'dungeon.diff.easy':       'Fácil',
      'dungeon.diff.medium':     'Médio',
      'dungeon.diff.hard':       'Difícil',
      // Potion section
      'dungeon.potion_label':    'Poção de Aventura',
      'dungeon.potion_optional': '(opcional)',
      'dungeon.none':            'Nenhuma',
      'dungeon.no_potions':      'Nenhuma poção de aventura disponível',
      // Battle panel misc
      'dungeon.remaining':       'restante',
      // Loot modal
      'dungeon.collect_close':   'Coletar e Fechar',
      'dungeon.complete':        '🎉 Masmorra Concluída!',
      'dungeon.stopped':         '🏃 Masmorra Interrompida',
      'dungeon.no_loot':         'Nenhum loot nesta corrida.',
      // Stamina warnings
      'dungeon.requires_level':  '🔒 Requer nível {n} (você está no nível {lvl})',
      'dungeon.no_stamina':      'Vigor insuficiente (precisa de {need}, tem {have})',
      // Item type labels
      'item.type.weapon':        'arma',
      'item.type.armor':         'armadura',
      'item.type.consumable':    'consumível',
      'item.wtype.melee':        'corpo a corpo',
      'item.wtype.ranged':       'à distância',
      'item.slot.body':          'corpo',
      'item.slot.shield':        'escudo',
      // Item names
      'item.name.1':             'Espada de Madeira',
      'item.name.2':             'Espada de Ferro',
      'item.name.3':             'Armadura de Couro',
      'item.name.4':             'Escudo de Ferro',
      'item.name.5':             'Poção de Vida',
      'item.name.6':             'Cenoura',
      'item.name.7':             'Maçã',
      'item.name.8':             'Arco Curto',
      'item.name.9':             'Espada de Aço',
      'item.name.10':            'Cota de Malha',
      'item.name.11':            'Armadura de Placas',
      'item.name.12':            'Escudo de Carvalho',
      'item.name.13':            'Escudo de Aço',
      'item.name.14':            'Escudo do Cavaleiro',
      'item.name.15':            'Jaqueta de Caçador',
      'item.name.16':            'Machado de Guerra',
      'item.name.17':            'Arco Longo',
      'item.name.18':            'Armadura do Guardião',
      'item.name.19':            'Escudo Torre',
      'item.name.20':            'Elixir Veloz',
      'item.name.21':            'Poção da Fortuna',
      'item.name.22':            'Tônico da Abundância',
      'item.name.23':            'Draught de Vitalidade',
      'item.name.24':            'Poção da Sabedoria',
      'item.name.25':            'Lâmina Carmesim',
      'item.name.26':            'Placa da Colheita',
      'item.name.27':            'Cutelo do Pântano',
      'item.name.28':            'Armadura do Brejo',
      // Item descriptions
      'item.desc.1':             'Uma espada básica de treinamento.',
      'item.desc.2':             'Uma lâmina de ferro resistente.',
      'item.desc.3':             'Leve, mas protetora.',
      'item.desc.4':             'Escudo pesado de ferro.',
      'item.desc.5':             'Restaura 5 HP.',
      'item.desc.6':             'Restaura 2 HP.',
      'item.desc.7':             'Restaura 1 HP.',
      'item.desc.8':             'Arma à distância. Usa Destreza.',
      'item.desc.9':             'Uma lâmina de aço finamente forjada.',
      'item.desc.10':            'Anéis de metal entrelaçados.',
      'item.desc.11':            'Armadura completa de placas pesadas.',
      'item.desc.12':            'Um escudo robusto de carvalho.',
      'item.desc.13':            'Defesa equilibrada com nervuras de aço.',
      'item.desc.14':            'Proteção imponente para campeões.',
      'item.desc.15':            'Armadura flexível para combate rápido.',
      'item.desc.16':            'Um machado pesado para golpes devastadores.',
      'item.desc.17':            'Arco de alta tensão com forte tração.',
      'item.desc.18':            'Placas em camadas para guardas de elite.',
      'item.desc.19':            'Escudo massivo com cobertura quase total.',
      'item.desc.20':            'Reduz o tempo de masmorra em 30%.',
      'item.desc.21':            'Melhora muito a qualidade do loot na masmorra.',
      'item.desc.22':            'Obtém 2 itens de loot extras na masmorra.',
      'item.desc.23':            'Restaura 1 de vigor ao completar a masmorra.',
      'item.desc.24':            'Dobra o XP ganho na masmorra.',
      'item.desc.25':            'Uma lâmina forjada com ferro de outono.',
      'item.desc.26':            'Armadura robusta de aço da colheita.',
      'item.desc.27':            'Cutelo pesado coberto com resina de pântano.',
      'item.desc.28':            'Armadura reforçada com escamas de pântano endurecidas.',

      // Battle panel
      'game.bp.hero':            '🧙 Herói',
      'game.bp.press_attack':    'Pressione Atacar para começar!',
      'game.bp.stop':            '🚪 Sair da Masmorra',

      // Inventory panel
      'game.inv.hint':           'Máx. 10 espaços · Borda dourada = equipado',

      // Equipment panel
      'game.eq.weapon':          'Arma',
      'game.eq.armor':           'Armadura',
      'game.eq.shield':          'Escudo',
      'game.eq.equip_from':      'Equipar do inventário:',

      // Stats panel
      'game.sp.title':           '📊 Status de Combate',
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
      'game.fp.start_action':    'Iniciar Fazenda',
      'game.fp.stop_action':     'Parar Fazenda',
      'game.fp.idle_status':     'Fazenda parada',
      'game.fp.running_status':  'Fazenda em andamento',
      'game.fp.busy_other_activity': 'Pare sua atividade atual primeiro',

      // Market panel
      'game.mp.your_gold':       'Seu ouro',
      'game.mp.desc':            'Venda itens e plantas por ouro. Itens equipados não podem ser vendidos.',
      'game.mp.tab_sell':        'Vender',
      'game.mp.tab_buy':         'Comprar',
      'game.mp.sell_desc':       'Venda itens por ouro. Itens equipados não podem ser vendidos.',
      'game.mp.buy_desc':        'Explore a loja e compre itens.',

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
      'game.js.empty':              'Vazio',
      'game.js.ranged':             '(à distância)',
      'game.js.melee':              '(corpo a corpo)',
      'game.js.dmg_unit':           'dano',
      'game.js.def_unit':           'def',
      'game.js.equip_btn':          'Equipar',
      'game.js.unequip_btn':        'Desequipar',
      'game.js.equipped_check':     '✓ Equipado',
      'game.js.no_equippable':      'Nenhum item equipável.',
      'game.js.item_unequipped':    'Item desequipado!',
      'game.js.nothing_harvested':  'Nada colhido ainda.',
      'game.js.no_plants_growing':  'Nenhuma planta crescendo.',
      'game.js.ready':              'Pronto!',
      'game.js.nothing_to_sell':    'Nada para vender.',
      'game.js.sell_one':           'Vender 1',
      'game.js.equipped_tag':       'Equipado',
      'game.js.buy_one':            'Comprar 1',
      'game.js.cant_buy':           'Não foi possível comprar o item',
      'game.js.bought_for':         '🪙 Comprado por {n}g!',
      'game.js.shop_empty':         'Nenhum item disponível.',
      'game.js.loading':            'Carregando…',
      'game.js.qty':                'Qtd',
      'game.js.each':               'cada',
      'game.js.click_to_sell':      'Clique para vender 1',
      'game.js.click_to_buy':       'Clique para comprar 1',
      'game.js.cant_afford':        'Ouro insuficiente',

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
