/* 官方獨有標籤的維度歸類（key＝官方英文名，value＝維度索引）
   0 大類型 1 子類型 2 視角 3 美術風格 4 題材 5 情緒 6 敘事 7 機制 8 玩家結構 9 範疇
   未列出的官方標籤由 build-tags.js 自動歸入維度 9 並標「未分類官方標籤」。 */
module.exports = {
  /* 0 大類型 */
  "Massively Multiplayer": 0,

  /* 1 子類型／玩法框架 */
  "Action-Adventure": 1, "Action Roguelike": 1, "Traditional Roguelike": 1,
  "Strategy RPG": 1, "Tactical RPG": 1, "Party-Based RPG": 1,
  "Dungeon Crawler": 1, "Mystery Dungeon": 1, "Collectathon": 1, "Runner": 1,
  "2D Fighter": 1, "3D Fighter": 1, "Spectacle fighter": 1,
  "Character Action Game": 1, "Musou": 1, "Action RTS": 1,
  "Space Sim": 1, "Automobile Sim": 1, "Combat Racing": 1,
  "Political Sim": 1, "Medical Sim": 1, "Outbreak Sim": 1,
  "Job Simulator": 1, "Hobby Sim": 1, "Shop Keeper": 1,
  "Trading Card Game": 1, "Solitaire": 1, "Otome": 1,
  "Chess": 1, "Poker": 1, "Mahjong": 1, "Dice": 1, "Pinball": 1,
  "Trivia": 1, "Typing": 1, "Spelling": 1, "Falling Blocks": 1,
  "Social Deduction": 1, "Choose Your Own Adventure": 1, "FMV": 1,
  "Top-Down Shooter": 1, "On-Rails Shooter": 1, "Sniper": 1, "Wargame": 1,
  "Incremental": 1, "Minigames": 1, "Party": 1, "Lemmings": 1,
  "Language Learning": 1, "Hunting": 1,
  /* 運動細分 */
  "Boxing": 1, "Basketball": 1, "Golf": 1, "Mini Golf": 1, "Baseball": 1,
  "Tennis": 1, "Hockey": 1, "Bowling": 1, "Volleyball": 1, "Cricket": 1,
  "Rugby": 1, "Snooker": 1, "Billiards": 1, "Wrestling": 1,
  "Skateboarding": 1, "Skiing": 1, "Snowboarding": 1, "Skating": 1,
  "Cycling": 1, "BMX": 1, "Motocross": 1, "Archery": 1,
  "Football (Soccer)": 1, "Football (American)": 1,

  /* 2 視角與維度 */
  "6DOF": 2,

  /* 3 美術風格 */
  "Colorful": 3, "Beautiful": 3, "Psychedelic": 3,

  /* 4 題材世界觀 */
  "Magic": 4, "Futuristic": 4, "Dystopian": 4, "Alternate History": 4,
  "Dragons": 4, "Demons": 4, "Elves": 4, "Dwarves": 4, "Vikings": 4,
  "Samurai": 4, "Rome": 4, "Mars": 4, "Snow": 4, "Underground": 4,
  "Horses": 4, "Animals": 4, "Birds": 4, "Wolves": 4, "Foxes": 4,
  "Capybaras": 4, "Zoo": 4,
  "Trains": 4, "Tanks": 4, "Submarine": 4, "Spaceships": 4,
  "Motorbike": 4, "Bikes": 4, "ATV": 4,
  "World War I": 4, "World War II": 4, "Cold War": 4,
  "Wuxia": 4, "Xianxia": 4, "Cult": 4, "Faith": 4,
  "Espionage": 4, "Conspiracy": 4, "Assassins": 4, "Heist": 4,
  "Superhero": 4, "Science": 4, "Capitalism": 4, "Transhumanism": 4,
  "Artificial Intelligence": 4, "1980s": 4,

  /* 5 情緒氛圍 */
  "Thriller": 5, "Dark Humor": 5, "Dark Comedy": 5, "Satire": 5, "Parody": 5,
  "Memes": 5, "Addictive": 5, "Immersive": 5, "Classic": 5, "Epic": 5,
  "Nostalgia": 5, "Jump Scare": 5,

  /* 6 敘事 */
  "Lore-Rich": 6, "Dialogue Heavy": 6, "Narrative": 6,
  "Linear": 6, "Nonlinear": 6, "Villain Protagonist": 6,
  "Dynamic Narration": 6, "Episodic": 6, "Based On A Novel": 6,
  "Remake": 6, "Sequel": 6, "Reboot": 6,

  /* 7 機制特徵 */
  "Combat": 7, "Inventory Management": 7, "Time Management": 7,
  "Turn-Based": 7, "Real-Time": 7, "Real-Time with Pause": 7,
  "Quick-Time Events": 7, "Gun Customization": 7, "Swordplay": 7,
  "Driving": 7, "Transportation": 7, "Offroad": 7, "Time Attack": 7,
  "Logic": 7, "Gambling": 7, "Mining": 7, "Sailing": 7, "Farming": 7,
  "Decorating": 7, "Organizing": 7, "Cleaning": 7, "Diplomacy": 7,
  "Music-Based Procedural Generation": 7, "Great Soundtrack": 7,
  "Electronic Music": 7, "Rock Music": 7, "Instrumental Music": 7, "8-bit Music": 7,
  "Tutorial": 7, "Controller": 7, "Mouse Only": 7, "Touch-Friendly": 7,
  "Voice Control": 7, "TrackIR": 7, "Intentionally Awkward Controls": 7,

  /* 8 玩家結構 */
  "Team-Based": 8, "Competitive": 8, "eSports": 8,
  "Co-op Campaign": 8, "Asynchronous Multiplayer": 8, "Asymmetric VR": 8,

  /* 9 範疇與受眾補充（含成人內容與非遊戲軟體） */
  "Sexual Content": 9, "Nudity": 9, "Hentai": 9,
  "Design & Illustration": 9, "Animation & Modeling": 9,
  "Video Production": 9, "Audio Production": 9, "Photo Editing": 9,
  "Game Development": 9, "Software Training": 9,
  "Benchmark": 9, "Hardware": 9, "Desktop Companion": 9,
  "360 Video": 9, "Mod": 9, "Gaming": 9,
};
