/**
 * Ear100 - 英語リスニング初心者向け 音読補助＆リスニング特化型アプリ（MVP v2）
 * --------------------------------------------------------------------
 * 「100単語」「100例文」だけはネイティブの発音と速さで完璧に聞き取れる状態にすることが目標。
 *
 * v2 での主な追加:
 *  - 100単語・100例文（本番データ差し替えまでの仮データ入り）
 *  - 20個ずつの5ステージ制（音読3回×20個＋ステージテスト全問正解で次ステージ解放）
 *  - テスト難易度（英文表示ON/OFF × 速度）と難易度別の合格記録マトリクス
 *  - テストモード3種（ステージ別20問 / 解放済み範囲シャッフル20問 / 全100問チャレンジ）
 *  - 全問正解で合格・9割で「おしい！もう一息！」表示
 *  - 間違えた問題の振り返り（テスト直後）＋間違い問題の練習モード・復習テスト
 *  - ステージクリアごとに豪華さが増すお祝い演出、全制覇で最大の祝福
 *
 * 調整したい数値はすべて下の CONFIG にまとまっている（速度の段階・合格ライン・救済日数など）。
 *
 * v2.1（録音音声テスト版）:
 *  - w1〜w5（sit / light / walk / seat / right）を録音音声（public/audio/*.mp3）で再生。
 *    item.audio が指定されている項目は Web Speech API の代わりに録音MP3を使う。
 *    倍速は audio.playbackRate（preservesPitch）で実現。テストの回答カウントは ended イベント起点。
 *  - セット再生を「TTSキュー積み」から「onend チェーン」方式に変更（録音とTTSの混在に対応）。
 *  - 選択肢生成時、英語または日本語が同一の別項目（walk / right の重複）を除外。
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LayoutDashboard,
  BookOpen,
  ListChecks,
  MessageSquare,
  Headphones,
  Play,
  Square,
  Volume2,
  Check,
  Trophy,
  Flame,
  Star,
  ChevronRight,
  Repeat,
  Gauge,
  Award,
  Calendar as CalendarIcon,
  Sparkles,
  ArrowLeft,
  Mic,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  Shuffle as ShuffleIcon,
  RotateCcw,
  PartyPopper,
  Target,
  CheckCircle2,
  ListPlus,
  Plus,
  Trash2,
  Hash,
  Calculator,
  Gift,
} from "lucide-react";

/* =========================================================================
 * 設定（教材設計に関わる数値はここだけ変えれば全体に反映される）
 * ======================================================================= */

const CONFIG = {
  STAGE_SIZE: 20,            // 1ステージあたりの単語・例文数
  SHADOW_REQUIRED: 3,        // ステージクリアに必要な1項目あたりの音読（シャドーイング）回数
  NEAR_MISS_RATIO: 0.9,      // この割合以上の正解で「おしい！もう一息！」表示
  LEARN_SPEEDS: [0.7, 1.0, 1.5, 2.0],  // 学習画面の速度の段階（0.5xは全廃）
  PLAY_GAP_MS: 150,          // 連続再生時の項目間ポーズ（ミリ秒）。実際のポーズはこの値÷再生速度（2.0xなら75ms）。
                             // デバイスごとの再生開始遅延のブレをこのポーズの中に吸収して、間隔の体感を揃える狙い。
  TEST_SPEEDS: [0.7, 1.0, 1.5, 2.0],        // テストの速度の段階（難易度記録の軸になる）
  SHUFFLE_TEST_SIZE: 20,     // 実力シャッフルテストの問題数
  ANSWER_TIMES: [6, 4, 3, 2],   // テストの回答時間の段階（秒。読み上げ終了後にカウント開始）
  DEFAULT_ANSWER_TIME: 2,       // 回答時間の初期値（秒）
  QUICK_UNLOCK_SHADOW_PER_ITEM: 20, // 「音読だけで解放」: テスト未合格でも、前ステージの全項目をこの回数ずつ音読すれば次ステージ解放（合格済みなら各SHADOW_REQUIRED回でOK）
  // マイリスト機能の解放タイミング:
  //   "start"    = 最初から使える
  //   "stage1"   = 単語または例文のステージ1テスト合格で解放（おすすめ: 正しい使い方を体験してから）
  //   "complete" = 100単語＋100例文の全制覇で解放（ご褒美機能）
  CUSTOM_UNLOCK: "start",
  SHOW_CUSTOM: false,        // マイリスト機能の表示（false=タブごと非表示。コードは残してあるのでtrueで復活できる）
  NUM_RANDOM_TEST_SIZE: 10,  // 数字ランダムテストの出題数
  NUM_DIGIT_CHOICES: [1, 2, 3, 4, 5], // 実力試しコーナーで選べる「上限桁数」（1〜この桁が混在）
  NUM_PRONOUNCE_SIZE: 10,    // 「自分で言えるかチェック」の出題数（そのステージの数字からランダム）
  NUM_STAGE_RANDOM_SIZE: 20, // ステージ内のランダムテスト（テスト3）の出題数
  POINTS_PER_CORRECT: 5,     // 1問正解ごとのポイント
  STAGE_CLEAR_BONUS: 100,    // ステージ初クリアのボーナス（×ステージ番号）
  KIND_COMPLETE_BONUS: 500,  // 単語100 / 例文100 それぞれの完全制覇ボーナス
  GRAND_COMPLETE_BONUS: 1000,// 単語＋例文の全制覇ボーナス
};

/* =========================================================================
 * データ（100件ずつ。※本番では講師提供のデータに差し替える。w11以降・s11以降は仮データ）
 * ======================================================================= */

const WORDS = [
  // ↓ w1〜w5 は録音音声（public/audio/ 内のMP3）を使うテスト用データ。
  //   audio の指定がある項目は Web Speech API の代わりに録音音声を再生する。
  //   単語と音声が合っていない場合は audio のファイル名を入れ替えるだけで修正できる。
  { id: "w1", en: "sit", ja: "座る", audio: "w1_sit.mp3" },
  { id: "w2", en: "light", ja: "光", audio: "w2_light.mp3" },
  { id: "w3", en: "walk", ja: "歩く", audio: "w3_walk.mp3" },
  { id: "w4", en: "seat", ja: "座席", audio: "w4_seat.mp3" },
  { id: "w5", en: "right", ja: "右", audio: "w5_right.mp3" },
  { id: "w6", en: "school", ja: "学校" },
  { id: "w7", en: "happy", ja: "幸せな" },
  { id: "w8", en: "important", ja: "重要な" },
  { id: "w9", en: "understand", ja: "理解する" },
  { id: "w10", en: "decide", ja: "決める" },
  { id: "w11", en: "family", ja: "家族" },
  { id: "w12", en: "breakfast", ja: "朝食" },
  { id: "w13", en: "lunch", ja: "昼食" },
  { id: "w14", en: "dinner", ja: "夕食" },
  { id: "w15", en: "station", ja: "駅" },
  { id: "w16", en: "ticket", ja: "切符" },
  { id: "w17", en: "money", ja: "お金" },
  { id: "w18", en: "time", ja: "時間" },
  { id: "w19", en: "today", ja: "今日" },
  { id: "w20", en: "tomorrow", ja: "明日" },
  { id: "w21", en: "yesterday", ja: "昨日" },
  { id: "w22", en: "weather", ja: "天気" },
  { id: "w23", en: "rain", ja: "雨" },
  { id: "w24", en: "sunny", ja: "晴れた" },
  { id: "w25", en: "cold", ja: "寒い" },
  { id: "w26", en: "hot", ja: "暑い" },
  { id: "w27", en: "weekend", ja: "週末" },
  { id: "w28", en: "holiday", ja: "休日" },
  { id: "w29", en: "work", ja: "働く" },
  { id: "w30", en: "job", ja: "仕事" },
  { id: "w31", en: "meeting", ja: "会議" },
  { id: "w32", en: "phone", ja: "電話" },
  { id: "w33", en: "computer", ja: "コンピュータ" },
  { id: "w34", en: "music", ja: "音楽" },
  { id: "w35", en: "movie", ja: "映画" },
  { id: "w36", en: "book", ja: "本" },
  { id: "w37", en: "coffee", ja: "コーヒー" },
  { id: "w38", en: "tea", ja: "お茶" },
  { id: "w39", en: "food", ja: "食べ物" },
  { id: "w40", en: "delicious", ja: "おいしい" },
  { id: "w41", en: "restaurant", ja: "レストラン" },
  { id: "w42", en: "menu", ja: "メニュー" },
  { id: "w43", en: "price", ja: "値段" },
  { id: "w44", en: "cheap", ja: "安い" },
  { id: "w45", en: "expensive", ja: "（値段が）高い" },
  { id: "w46", en: "big", ja: "大きい" },
  { id: "w47", en: "small", ja: "小さい" },
  { id: "w48", en: "new", ja: "新しい" },
  { id: "w49", en: "old", ja: "古い" },
  { id: "w50", en: "beautiful", ja: "美しい" },
  { id: "w51", en: "interesting", ja: "面白い" },
  { id: "w52", en: "difficult", ja: "難しい" },
  { id: "w53", en: "easy", ja: "簡単な" },
  { id: "w54", en: "fun", ja: "楽しい" },
  { id: "w55", en: "tired", ja: "疲れた" },
  { id: "w56", en: "busy", ja: "忙しい" },
  { id: "w57", en: "free", ja: "ひまな" },
  { id: "w58", en: "early", ja: "（時間が）早い" },
  { id: "w59", en: "late", ja: "遅い" },
  { id: "w60", en: "fast", ja: "（速度が）速い" },
  { id: "w61", en: "slow", ja: "ゆっくりした" },
  { id: "w62", en: "open", ja: "開く" },
  { id: "w63", en: "close", ja: "閉める" },
  { id: "w64", en: "buy", ja: "買う" },
  { id: "w65", en: "sell", ja: "売る" },
  { id: "w66", en: "eat", ja: "食べる" },
  { id: "w67", en: "drink", ja: "飲む" },
  { id: "w68", en: "walk", ja: "歩く" },
  { id: "w69", en: "run", ja: "走る" },
  { id: "w70", en: "sleep", ja: "眠る" },
  { id: "w71", en: "wake up", ja: "目を覚ます" },
  { id: "w72", en: "study", ja: "勉強する" },
  { id: "w73", en: "learn", ja: "学ぶ" },
  { id: "w74", en: "teach", ja: "教える" },
  { id: "w75", en: "speak", ja: "話す" },
  { id: "w76", en: "listen", ja: "聞く" },
  { id: "w77", en: "read", ja: "読む" },
  { id: "w78", en: "write", ja: "書く" },
  { id: "w79", en: "remember", ja: "覚えている" },
  { id: "w80", en: "forget", ja: "忘れる" },
  { id: "w81", en: "ask", ja: "尋ねる" },
  { id: "w82", en: "answer", ja: "答える" },
  { id: "w83", en: "help", ja: "助ける" },
  { id: "w84", en: "wait", ja: "待つ" },
  { id: "w85", en: "start", ja: "始める" },
  { id: "w86", en: "finish", ja: "終える" },
  { id: "w87", en: "arrive", ja: "到着する" },
  { id: "w88", en: "leave", ja: "出発する" },
  { id: "w89", en: "travel", ja: "旅行する" },
  { id: "w90", en: "airport", ja: "空港" },
  { id: "w91", en: "hotel", ja: "ホテル" },
  { id: "w92", en: "room", ja: "部屋" },
  { id: "w93", en: "train", ja: "電車" },
  { id: "w94", en: "bus", ja: "バス" },
  { id: "w95", en: "taxi", ja: "タクシー" },
  { id: "w96", en: "left", ja: "左" },
  { id: "w97", en: "right", ja: "右" },
  { id: "w98", en: "near", ja: "近い" },
  { id: "w99", en: "far", ja: "遠い" },
  { id: "w100", en: "together", ja: "一緒に" },
];

const SENTENCES = [
  { id: "s1", en: "Nice to meet you.", ja: "はじめまして。" },
  { id: "s2", en: "How much is this?", ja: "これはいくらですか？" },
  { id: "s3", en: "Where is the station?", ja: "駅はどこですか？" },
  { id: "s4", en: "Can I have the menu, please?", ja: "メニューをいただけますか？" },
  { id: "s5", en: "I'm looking forward to it.", ja: "楽しみにしています。" },
  { id: "s6", en: "What time does it open?", ja: "何時に開きますか？" },
  { id: "s7", en: "Could you take a picture for me?", ja: "写真を撮っていただけますか？" },
  { id: "s8", en: "I'll have the same, please.", ja: "同じものをお願いします。" },
  { id: "s9", en: "Is this seat taken?", ja: "この席は空いていますか？" },
  { id: "s10", en: "Thank you for your help.", ja: "手伝ってくれてありがとう。" },
  { id: "s11", en: "Good morning.", ja: "おはようございます。" },
  { id: "s12", en: "See you tomorrow.", ja: "また明日。" },
  { id: "s13", en: "How are you?", ja: "元気ですか？" },
  { id: "s14", en: "I'm fine, thank you.", ja: "元気です、ありがとう。" },
  { id: "s15", en: "What's your name?", ja: "お名前は何ですか？" },
  { id: "s16", en: "My name is Ken.", ja: "私の名前はケンです。" },
  { id: "s17", en: "Where are you from?", ja: "出身はどちらですか？" },
  { id: "s18", en: "I'm from Japan.", ja: "日本出身です。" },
  { id: "s19", en: "Excuse me.", ja: "すみません。" },
  { id: "s20", en: "Sorry, I'm late.", ja: "遅れてごめんなさい。" },
  { id: "s21", en: "No problem.", ja: "問題ありません。" },
  { id: "s22", en: "Of course.", ja: "もちろんです。" },
  { id: "s23", en: "Just a moment, please.", ja: "少々お待ちください。" },
  { id: "s24", en: "Could you say that again?", ja: "もう一度言っていただけますか？" },
  { id: "s25", en: "Please speak slowly.", ja: "ゆっくり話してください。" },
  { id: "s26", en: "I don't understand.", ja: "わかりません。" },
  { id: "s27", en: "What does this mean?", ja: "これはどういう意味ですか？" },
  { id: "s28", en: "Can you help me?", ja: "手伝ってもらえますか？" },
  { id: "s29", en: "What time is it now?", ja: "今何時ですか？" },
  { id: "s30", en: "It's ten o'clock.", ja: "10時です。" },
  { id: "s31", en: "What day is it today?", ja: "今日は何曜日ですか？" },
  { id: "s32", en: "It's Monday.", ja: "月曜日です。" },
  { id: "s33", en: "How's the weather today?", ja: "今日の天気はどうですか？" },
  { id: "s34", en: "It's sunny today.", ja: "今日は晴れです。" },
  { id: "s35", en: "It looks like rain.", ja: "雨が降りそうです。" },
  { id: "s36", en: "I'm hungry.", ja: "お腹がすきました。" },
  { id: "s37", en: "I'm thirsty.", ja: "のどが渇きました。" },
  { id: "s38", en: "Let's take a break.", ja: "休憩しましょう。" },
  { id: "s39", en: "Let's eat lunch together.", ja: "一緒に昼食を食べましょう。" },
  { id: "s40", en: "What do you want to eat?", ja: "何が食べたいですか？" },
  { id: "s41", en: "I'd like a coffee, please.", ja: "コーヒーをお願いします。" },
  { id: "s42", en: "Anything else?", ja: "他に何かありますか？" },
  { id: "s43", en: "That's all, thank you.", ja: "以上です、ありがとう。" },
  { id: "s44", en: "Check, please.", ja: "お会計をお願いします。" },
  { id: "s45", en: "Can I pay by card?", ja: "カードで払えますか？" },
  { id: "s46", en: "Here you are.", ja: "はい、どうぞ。" },
  { id: "s47", en: "It was delicious.", ja: "おいしかったです。" },
  { id: "s48", en: "I'm just looking.", ja: "見ているだけです。" },
  { id: "s49", en: "Do you have a bigger one?", ja: "もっと大きいものはありますか？" },
  { id: "s50", en: "Can I try this on?", ja: "試着してもいいですか？" },
  { id: "s51", en: "I'll take it.", ja: "これをください。" },
  { id: "s52", en: "It's too expensive.", ja: "高すぎます。" },
  { id: "s53", en: "Can you give me a discount?", ja: "安くしてもらえますか？" },
  { id: "s54", en: "Where is the restroom?", ja: "トイレはどこですか？" },
  { id: "s55", en: "Go straight, please.", ja: "まっすぐ行ってください。" },
  { id: "s56", en: "Turn left at the corner.", ja: "角を左に曲がってください。" },
  { id: "s57", en: "It's on your right.", ja: "右側にあります。" },
  { id: "s58", en: "Is it far from here?", ja: "ここから遠いですか？" },
  { id: "s59", en: "You can walk there.", ja: "歩いて行けますよ。" },
  { id: "s60", en: "How long does it take?", ja: "どのくらい時間がかかりますか？" },
  { id: "s61", en: "About ten minutes.", ja: "10分くらいです。" },
  { id: "s62", en: "I'm lost.", ja: "道に迷いました。" },
  { id: "s63", en: "Where can I buy a ticket?", ja: "切符はどこで買えますか？" },
  { id: "s64", en: "Which train goes to Tokyo?", ja: "どの電車が東京へ行きますか？" },
  { id: "s65", en: "Does this bus stop at the hotel?", ja: "このバスはホテルに止まりますか？" },
  { id: "s66", en: "I want to go to the airport.", ja: "空港へ行きたいです。" },
  { id: "s67", en: "What time does the next train leave?", ja: "次の電車は何時に出ますか？" },
  { id: "s68", en: "I missed my train.", ja: "電車に乗り遅れました。" },
  { id: "s69", en: "I have a reservation.", ja: "予約しています。" },
  { id: "s70", en: "Do you have a room for tonight?", ja: "今夜泊まれる部屋はありますか？" },
  { id: "s71", en: "What time is check-out?", ja: "チェックアウトは何時ですか？" },
  { id: "s72", en: "Can I leave my bag here?", ja: "ここに荷物を預けられますか？" },
  { id: "s73", en: "The key doesn't work.", ja: "鍵が開きません。" },
  { id: "s74", en: "Could you call a taxi for me?", ja: "タクシーを呼んでいただけますか？" },
  { id: "s75", en: "What do you do?", ja: "お仕事は何をしていますか？" },
  { id: "s76", en: "I work at a bank.", ja: "銀行で働いています。" },
  { id: "s77", en: "What are your hobbies?", ja: "趣味は何ですか？" },
  { id: "s78", en: "I like watching movies.", ja: "映画を見るのが好きです。" },
  { id: "s79", en: "Me too.", ja: "私もです。" },
  { id: "s80", en: "That sounds fun.", ja: "楽しそうですね。" },
  { id: "s81", en: "Are you free this weekend?", ja: "今週末はひまですか？" },
  { id: "s82", en: "Let's meet at the station.", ja: "駅で会いましょう。" },
  { id: "s83", en: "I'm on my way.", ja: "今向かっています。" },
  { id: "s84", en: "I'll be there soon.", ja: "すぐに着きます。" },
  { id: "s85", en: "Take care.", ja: "気をつけてね。" },
  { id: "s86", en: "Have a nice day.", ja: "良い一日を。" },
  { id: "s87", en: "Long time no see.", ja: "お久しぶりです。" },
  { id: "s88", en: "What's wrong?", ja: "どうしたのですか？" },
  { id: "s89", en: "I have a headache.", ja: "頭が痛いです。" },
  { id: "s90", en: "I feel much better now.", ja: "だいぶ良くなりました。" },
  { id: "s91", en: "Don't worry.", ja: "心配しないで。" },
  { id: "s92", en: "Good luck.", ja: "がんばってね。" },
  { id: "s93", en: "Congratulations!", ja: "おめでとう！" },
  { id: "s94", en: "That's a good idea.", ja: "それは良い考えですね。" },
  { id: "s95", en: "I agree with you.", ja: "あなたに賛成です。" },
  { id: "s96", en: "I think so, too.", ja: "私もそう思います。" },
  { id: "s97", en: "May I come in?", ja: "入ってもいいですか？" },
  { id: "s98", en: "Please have a seat.", ja: "どうぞお座りください。" },
  { id: "s99", en: "It's time to go.", ja: "もう行く時間です。" },
  { id: "s100", en: "Thank you for everything.", ja: "いろいろとありがとうございました。" },
];

// 20個ずつのステージに分割するユーティリティ
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================================================================
 * 数字データ（数字学習・数字テスト用）
 *  - ステージは桁数ベースの5段階（単語と同じくテスト合格で次が解放）
 *  - en = 表示・読み上げ用の数字（例 "23,456"）、ja = 英語の読み（例 "twenty-three thousand ..."）
 *  - 将来のパーツ連結録音方式（1〜19 / 20〜90 / hundred / thousand の約40パーツを録音して連結）に
 *    差し替えやすいよう、読み上げの入口は speakNumber() に一本化してある
 * ======================================================================= */

const NUM_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const NUM_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

// 数値 → 英語の読み（99,999まで対応）
function numToWords(n) {
  if (n < 0) return String(n);
  if (n < 20) return NUM_ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return NUM_TENS[t] + (r ? "-" + NUM_ONES[r] : "");
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return NUM_ONES[h] + " hundred" + (r ? " " + numToWords(r) : "");
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    return numToWords(th) + " thousand" + (r ? " " + numToWords(r) : "");
  }
  return String(n);
}

function fmtNum(n) {
  return n.toLocaleString("en-US");
}

const NUM_STAGE_TITLES = ["1〜20", "2桁と聞き分け", "3桁", "4桁", "5桁"];

// 各ステージ: shadow = 音読練習に出す数字 / testExtra = 音読には出さないがテストには出す数字
const NUM_STAGE_DATA = [
  {
    // ステージ1: 1〜20
    shadow: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    testExtra: [],
  },
  {
    // ステージ2: 2桁（20を追加）。13〜19はステージ1で音読済みなので音読からは外し、
    // -teen/-ty の聞き分け確認としてテストにだけ出す
    shadow: [20, 21, 30, 32, 40, 43, 50, 54, 60, 65, 70, 76, 80, 87, 90, 98],
    testExtra: [13, 14, 15, 16, 17, 18, 19],
  },
  {
    // ステージ3: 3桁（ゼロ入り・端数ありを混在）
    shadow: [100, 105, 123, 200, 234, 300, 345, 400, 456, 500, 567, 600, 678, 700, 789, 800, 891, 900, 923, 999],
    testExtra: [],
  },
  {
    // ステージ4: 4桁（きりのいい数・全桁埋まった数・ゼロが飛んだ数をバランスよく）
    shadow: [
      1000, 1234, 1500, 1080, 2000, 2345, 2007, 3000, 3456, 3090,
      4000, 4567, 4004, 5000, 5678, 5050, 6789, 6300, 7890, 7002,
      8000, 8765, 9000, 9999, 9101,
    ],
    testExtra: [],
  },
  {
    // ステージ5: 5桁（ゼロ入り・-teen/-ty混同・全桁埋まりを混在）
    shadow: [
      10000, 10500, 12345, 13030, 15050, 19019, 20000, 21000, 24680, 30013,
      35007, 40073, 45678, 50005, 55555, 60900, 67890, 70017, 84706, 90019,
      95040, 99999,
    ],
    testExtra: [],
  },
];

const toNumItem = (v) => ({ id: `n${v}`, value: v, en: fmtNum(v), ja: numToWords(v) });
// 音読練習用（学習画面に出る項目）
const NUM_STAGE_ITEMS = NUM_STAGE_DATA.map((st) => st.shadow.map(toNumItem));
// テスト2（音読に出た問題＋テスト専用の追加）で使う項目
const NUM_STAGE_TEST_ITEMS = NUM_STAGE_DATA.map((st) =>
  [...st.shadow, ...st.testExtra].map(toNumItem)
);
const NUMBERS = NUM_STAGE_TEST_ITEMS.flat();

// -teen / -ty 聞き分けドリルのペア
const TEEN_TY_PAIRS = [
  [13, 30], [14, 40], [15, 50], [16, 60], [17, 70], [18, 80], [19, 90],
];

// 数字 → 録音パーツ列への分解。
// エリー先生の録音から切り出した203パーツ（cont_1〜99 / term_1〜99 / thousand・hundred の cont/term / zero）を
// 間0ms（butt join）で連結して 0〜99,999 を自然な発音で再現する。
//   cont_N  = 継続版（後ろに語が続く↗。千の位・百の位で使用）
//   term_N  = 終止版（数字の最後↘。下2桁で使用）
//   *_cont / *_term = thousand / hundred の継続版・終止版
// 連結ルール（decompose）:
//   n=0 → [zero]
//   T=⌊n/1000⌋, R=n%1000, H=⌊R/100⌋, r2=R%100
//   T>0: cont_T +（R>0 ? thousand_cont : thousand_term）
//   H>0: cont_H +（r2>0 ? hundred_cont : hundred_term）
//   r2>0: term_r2
function decomposeNumberParts(value) {
  let n = Math.max(0, Math.min(99999, Math.floor(value)));
  if (n === 0) return ["zero"];
  const out = [];
  const T = Math.floor(n / 1000);
  const R = n % 1000;
  const H = Math.floor(R / 100);
  const r2 = R % 100;
  if (T > 0) {
    out.push("cont_" + T);
    out.push(R > 0 ? "thousand_cont" : "thousand_term");
  }
  if (H > 0) {
    out.push("cont_" + H);
    out.push(r2 > 0 ? "hundred_cont" : "hundred_term");
  }
  if (r2 > 0) out.push("term_" + r2);
  return out;
}

// 数字の読み上げ入口。録音パーツ列（parts）＋表示/TTSフォールバック用テキスト（en）を返す。
//   speak() は item.parts があればパーツを連結再生し、無ければ en を TTS で読む。
function makeNumberSpeakTarget(value) {
  return { en: fmtNum(value), parts: decomposeNumberParts(value) };
}

/* =========================================================================
 * 特典（数字パート）: 時計・お金・チップ・電話
 *   引き継ぎ §4 の target-builder。実スプライト（extras / nums）の part ID 列を返す。
 *   speak() は item.parts があればパーツを連結再生する（extras/nums は getNumberPartBuffer が自動判別）。
 *   当面 1倍速のみ（extras は 100 だけ）。
 * ======================================================================= */
const pad2 = (v) => String(v).padStart(2, "0");

// 時計 H:MM → parts。 :00=[oclock_H] / :0M=[xoh_H,dig_M] / :MM=[cont_H,term_MM]
function makeClockTarget(h, m) {
  const disp = `${h}:${pad2(m)}`;
  let parts;
  if (m === 0) parts = [`oclock_${h}`];
  else if (m < 10) parts = [`xoh_${h}`, `dig_${m}`];
  else parts = [`cont_${h}`, `term_${m}`];
  return { type: "clock", disp, en: disp, h, m, parts };
}
// 価格 $D.CC → parts。 .0C=[xoh_D,dig_C] / .CC=[cont_D,term_CC]
function makePriceTarget(d, c) {
  const disp = `$${d}.${pad2(c)}`;
  let parts;
  if (c < 10) parts = [`xoh_${d}`, `dig_${c}`];
  else parts = [`cont_${d}`, `term_${c}`];
  return { type: "price", disp, en: disp, d, c, parts };
}
// 丸ドル $D → [dollars_D]（録音済み 15/20/50 のみ）
function makeWholeDollarTarget(d) {
  return { type: "whole", disp: `$${d}`, en: `$${d}`, d, parts: [`dollars_${d}`] };
}
// チップ X% → [pct_X]（録音済み 15/18/20/25 のみ）
function makeTipTarget(x) {
  return { type: "tip", disp: `${x}%`, en: `${x}%`, x, parts: [`pct_${x}`] };
}
// 電話 3-3-4: area/prefix/line を別番号のかたまりからランダム結合。グループ間0.32s。
//   blocks = [a,b,c]（各 1..10）。表示・答え合わせには各ブロックの実桁マップが別途必要（未提供）。
const PHONE_GROUP_GAP = 0.32;
function makePhoneTarget(blocks) {
  const [a, b, c] = blocks;
  const parts = [`p${pad2(a)}_a`, `p${pad2(b)}_b`, `p${pad2(c)}_c`];
  // 各グループの後に 0.32s（最後は0）。
  const partGaps = [PHONE_GROUP_GAP, PHONE_GROUP_GAP, 0];
  return { type: "phone", parts, partGaps, blocks };
}

// 表示文字列から時計/価格の target を復元（データは disp を持つ）
function bonusItemToTarget(it) {
  switch (it.type) {
    case "clock": return makeClockTarget(it.h, it.m);
    case "price": return makePriceTarget(it.d, it.c);
    case "whole": return makeWholeDollarTarget(it.d);
    case "tip": return makeTipTarget(it.x);
    case "phone": return makePhoneTarget([it.a, it.b, it.c]);
    default: return { en: it.disp || "", disp: it.disp || "" };
  }
}

// 電話 3-3-4 の固定バンク（実桁マップ）。index 1..10 → 各ブロックの実桁。
// a=area / b=prefix / c=line。録音は10本まるごと、3-3-4で切り出してランダム結合できる。
const PHONE_BLOCKS = {
  a: { 1: "212", 2: "646", 3: "917", 4: "358", 5: "720", 6: "573", 7: "264", 8: "830", 9: "491", 10: "605" },
  b: { 1: "486", 2: "350", 3: "604", 4: "149", 5: "586", 6: "902", 7: "817", 8: "475", 9: "263", 10: "938" },
  c: { 1: "3907", 2: "7241", 3: "2853", 4: "6072", 5: "3491", 6: "4186", 7: "5093", 8: "6129", 9: "8570", 10: "1427" },
};
// 電話アイテム（a,b,c は 1..10 のブロックindex）。disp と正解桁を組み立てる。
function phoneItem(a, b, c) {
  const A = PHONE_BLOCKS.a[a], B = PHONE_BLOCKS.b[b], C = PHONE_BLOCKS.c[c];
  return { type: "phone", a, b, c, disp: `(${A}) ${B}-${C}`, digits: A + B + C };
}

// 承認済みデモ（tabi_stage_demo.html）の確定データ。shadow=音読20問 / testExtra=t3で混ぜる未練習分。
const BONUS_DATA = {
  time: {
    label: "時間",
    shadow: [
      { type: "clock", disp: "7:00", h: 7, m: 0 }, { type: "clock", disp: "10:00", h: 10, m: 0 },
      { type: "clock", disp: "12:00", h: 12, m: 0 }, { type: "clock", disp: "3:00", h: 3, m: 0 },
      { type: "clock", disp: "9:00", h: 9, m: 0 }, { type: "clock", disp: "7:05", h: 7, m: 5 },
      { type: "clock", disp: "9:03", h: 9, m: 3 }, { type: "clock", disp: "3:08", h: 3, m: 8 },
      { type: "clock", disp: "10:07", h: 10, m: 7 }, { type: "clock", disp: "12:01", h: 12, m: 1 },
      { type: "clock", disp: "7:15", h: 7, m: 15 }, { type: "clock", disp: "8:30", h: 8, m: 30 },
      { type: "clock", disp: "10:45", h: 10, m: 45 }, { type: "clock", disp: "6:20", h: 6, m: 20 },
      { type: "clock", disp: "11:40", h: 11, m: 40 }, { type: "clock", disp: "7:50", h: 7, m: 50 },
      { type: "clock", disp: "8:15", h: 8, m: 15 }, { type: "clock", disp: "3:13", h: 3, m: 13 },
      { type: "clock", disp: "3:30", h: 3, m: 30 }, { type: "clock", disp: "5:00", h: 5, m: 0 },
    ],
    testExtra: [
      { type: "clock", disp: "5:07", h: 5, m: 7 }, { type: "clock", disp: "11:15", h: 11, m: 15 },
      { type: "clock", disp: "6:50", h: 6, m: 50 }, { type: "clock", disp: "9:30", h: 9, m: 30 },
      { type: "clock", disp: "8:45", h: 8, m: 45 }, { type: "clock", disp: "10:20", h: 10, m: 20 },
    ],
  },
  money: {
    label: "お金",
    // 承認済みデモの「お金」20問（価格13＋丸ドル3＋チップ4）。チップはお金パート内に混在。
    shadow: [
      { type: "price", disp: "$3.15", d: 3, c: 15 }, { type: "price", disp: "$8.50", d: 8, c: 50 },
      { type: "price", disp: "$12.99", d: 12, c: 99 }, { type: "price", disp: "$18.50", d: 18, c: 50 },
      { type: "price", disp: "$24.88", d: 24, c: 88 }, { type: "price", disp: "$6.20", d: 6, c: 20 },
      { type: "price", disp: "$9.05", d: 9, c: 5 }, { type: "price", disp: "$7.08", d: 7, c: 8 },
      { type: "price", disp: "$7.15", d: 7, c: 15 }, { type: "price", disp: "$7.50", d: 7, c: 50 },
      { type: "price", disp: "$13.99", d: 13, c: 99 }, { type: "price", disp: "$30.99", d: 30, c: 99 },
      { type: "price", disp: "$5.05", d: 5, c: 5 },
      { type: "whole", disp: "$15", d: 15 }, { type: "whole", disp: "$20", d: 20 },
      { type: "whole", disp: "$50", d: 50 },
      { type: "tip", disp: "15%", x: 15 }, { type: "tip", disp: "18%", x: 18 },
      { type: "tip", disp: "20%", x: 20 }, { type: "tip", disp: "25%", x: 25 },
    ],
    testExtra: [
      { type: "price", disp: "$5.13", d: 5, c: 13 }, { type: "price", disp: "$18.20", d: 18, c: 20 },
      { type: "price", disp: "$24.15", d: 24, c: 15 }, { type: "price", disp: "$8.88", d: 8, c: 88 },
      { type: "price", disp: "$30.45", d: 30, c: 45 }, { type: "price", disp: "$13.60", d: 13, c: 60 },
    ],
  },
  phone: {
    label: "電話",
    // 固定バンクから 3-3-4 をランダム結合（音読は代表12本）。テストは shadow+testExtra を出題。
    shadow: [
      phoneItem(1, 1, 1), phoneItem(2, 2, 2), phoneItem(3, 3, 3), phoneItem(4, 4, 4),
      phoneItem(5, 5, 5), phoneItem(6, 6, 6), phoneItem(1, 5, 9), phoneItem(2, 7, 4),
      phoneItem(3, 8, 6), phoneItem(7, 2, 10), phoneItem(9, 4, 1), phoneItem(10, 6, 3),
    ],
    testExtra: [
      phoneItem(8, 3, 5), phoneItem(4, 9, 7), phoneItem(5, 1, 2), phoneItem(6, 10, 8),
    ],
  },
};

// 特典テストの合格ライン・ボーナス
const BONUS_PASS_RATIO = 0.8;   // 8割で合格
const BONUS_CLEAR_BONUS = 50;   // 合格ボーナス（初回・再合格問わず加点）
const BONUS_TEST_LABELS = ["自分で言えるかチェック", "練習した問題のテスト", "新しい問題でランダムテスト"];

// --- テスト3用: 練習に出てこない新しい問題を生成（録音済みの範囲だけを使うので音欠けしない） ---
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
function genClockItem() {
  const h = randInt(1, 12);
  // :00 / 1桁分 / 2桁分 をバランスよく（2桁分を多めに）
  const kind = pickOne(["oclock", "single", "double", "double"]);
  let m;
  if (kind === "oclock") m = 0;
  else if (kind === "single") m = randInt(1, 9);
  else m = randInt(10, 59);
  return { type: "clock", disp: `${h}:${pad2(m)}`, h, m };
}
function genMoneyItem() {
  const r = Math.random();
  if (r < 0.12) return { type: "whole", disp: `$${pickOne([15, 20, 50])}`, d: pickOne([15, 20, 50]) };
  if (r < 0.24) { const x = pickOne([15, 18, 20, 25]); return { type: "tip", disp: `${x}%`, x }; }
  // 価格: 1桁セントは $D≤12（xoh の録音範囲）、2桁セントは $1〜30
  if (Math.random() < 0.3) {
    const d = randInt(1, 12), c = randInt(1, 9);
    return { type: "price", disp: `$${d}.${pad2(c)}`, d, c };
  }
  const d = randInt(1, 30), c = randInt(10, 99);
  return { type: "price", disp: `$${d}.${pad2(c)}`, d, c };
}
function genPhoneItem() {
  return phoneItem(randInt(1, 10), randInt(1, 10), randInt(1, 10));
}
function genBonusItems(mod, n) {
  const gen = mod === "time" ? genClockItem : mod === "phone" ? genPhoneItem : genMoneyItem;
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard++;
    const it = gen();
    if (seen.has(it.disp)) continue; // 同一問題の重複を避ける
    seen.add(it.disp);
    out.push(it);
  }
  return out;
}

// --- ホーム: 総合ポイントのマイルストーン（旅テーマの達成レベル） ---
const POINT_MILESTONES = [
  { pt: 0, label: "出発準備", emoji: "🧳" },
  { pt: 300, label: "空港チェックイン", emoji: "🎫" },
  { pt: 800, label: "離陸", emoji: "🛫" },
  { pt: 1500, label: "ニューヨーク上空", emoji: "✈️" },
  { pt: 2500, label: "マンハッタン到着", emoji: "🗽" },
  { pt: 4000, label: "旅の達人", emoji: "🏆" },
];
function milestoneProgress(points) {
  let idx = 0;
  for (let i = 0; i < POINT_MILESTONES.length; i++) if (points >= POINT_MILESTONES[i].pt) idx = i;
  const cur = POINT_MILESTONES[idx];
  const next = POINT_MILESTONES[idx + 1] || null;
  const ratio = next ? Math.min(1, (points - cur.pt) / (next.pt - cur.pt)) : 1;
  return { idx, cur, next, ratio };
}
function genRandomNumbers(digits, count) {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < 1000) {
    set.add(min + Math.floor(Math.random() * (max - min + 1)));
    guard += 1;
  }
  return Array.from(set);
}

// ステージごとの「テスト3（ランダム）」で出す数値の範囲
//   ステージ1は1〜20、ステージ2以降はその桁数のランダム
const NUM_STAGE_RANDOM_RANGE = [
  { min: 1, max: 20 },     // ステージ1
  { min: 10, max: 99 },    // ステージ2（2桁）
  { min: 100, max: 999 },  // ステージ3（3桁）
  { min: 1000, max: 9999 },      // ステージ4（4桁）
  { min: 10000, max: 99999 },    // ステージ5（5桁）
];

// 指定範囲のランダムな数を count 個（重複なし）生成
function genRangeNumbers(min, max, count) {
  const set = new Set();
  const span = max - min + 1;
  let guard = 0;
  while (set.size < Math.min(count, span) && guard < 3000) {
    set.add(min + Math.floor(Math.random() * span));
    guard += 1;
  }
  return Array.from(set);
}

// 「1桁〜maxDigits桁が混在する」ランダムな数を count 個生成（実力試しコーナー用）
//  上の桁ほど多く出す重み付け（1〜2桁は少なめ）。重み = 桁数の2乗、ただし1〜2桁はさらに抑える。
function genMixedRandomNumbers(maxDigits, count) {
  const weights = [];
  for (let d = 1; d <= maxDigits; d++) {
    let w = d * d;              // 桁が大きいほど重い
    if (d <= 2) w = w * 0.35;   // 1〜2桁はさらに出にくくする
    weights.push(w);
  }
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pickDigits = () => {
    let r = Math.random() * totalW;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i + 1;
    }
    return maxDigits;
  };

  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < 3000) {
    const d = pickDigits();
    const min = d === 1 ? 1 : Math.pow(10, d - 1);
    const max = Math.pow(10, d) - 1;
    set.add(min + Math.floor(Math.random() * (max - min + 1)));
    guard += 1;
  }
  return Array.from(set);
}

/* =========================================================================
 * 日付・配列ユーティリティ
 * ======================================================================= */

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return formatDate(new Date());
}

function daysSinceKey(key) {
  try {
    const [y, m, d] = key.split("-").map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((today0 - then) / 86400000);
  } catch (e) {
    return 0;
  }
}

function lastNDays(n) {
  const arr = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    arr.push({ date: d, key: formatDate(d) });
  }
  return arr;
}

function computeStreak(studyDays) {
  const set = new Set(studyDays);
  let cursor = new Date();
  if (!set.has(formatDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(formatDate(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(formatDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sumValues(obj) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

function buildChoices(items, correct) {
  if (!correct) return [];
  // id違いでも英語または日本語が同じ項目（例: w3 walk と w68 walk）は選択肢から除外する
  const others = shuffle(
    items.filter((i) => i.id !== correct.id && i.en !== correct.en && i.ja !== correct.ja)
  ).slice(0, 3);
  return shuffle([correct, ...others]).map((i) => ({ id: i.id, label: i.ja }));
}

// テスト難易度（英文表示 × 速度）を1つのキーにする
function makeDiffKey(showText, speed, answerSec) {
  return `${showText ? "on" : "off"}|${Number(speed).toFixed(1)}|${answerSec}`;
}

function diffLabel(showText, speed, answerSec) {
  return `${showText ? "英文あり" : "英文なし"}・${Number(speed).toFixed(1)}x・${answerSec}秒`;
}

// diffKey を分解（旧バージョンの2要素キーは回答時間4秒として扱う）
function parseDiffKey(key) {
  const [show, speed, sec] = key.split("|");
  return { show: show === "on", speed: Number(speed), sec: sec ? Number(sec) : 4 };
}

/* =========================================================================
 * LocalStorage 永続化（v2。v1 のデータからは基本項目を引き継ぐ）
 * ======================================================================= */

const STORAGE_KEY = "ear100_test_app_state_v1"; // テスト版専用キー（本番の ear100_app_state_v2 とは別管理）
const LEGACY_STORAGE_KEY = "ear100_test_legacy_unused"; // テスト版では旧データ移行は行わない

const DEFAULT_STATE = {
  studyDays: [],
  // 日付ごとにどの種類を学習したか: studyLog["YYYY-MM-DD"] = { word:true, sent:true, num:true } のような形
  studyLog: {},
  totalPoints: 0,
  wordShadow: {},
  sentShadow: {},
  customShadow: {},
  numShadow: {},
  // 自分で追加した単語・例文（マイリスト）: [{ id, en, ja }]
  customItems: [],
  // アプリ設定（unlockMode: "test"=テスト合格で解放（標準） / "shadow"=音読だけで解放（どんどん進む））
  //   learnPrefs: 学習画面のリピート回数・速度 / testPrefs: テストの英文表示・速度・回答時間（次回も維持）
  settings: {
    unlockMode: "test",
    learnPrefs: { repeat: 3, speed: 1.0 },
    testPrefs: { showText: null, speed: 1.0, answerSec: CONFIG.DEFAULT_ANSWER_TIME },
    numTestPrefs: { speed: 1.0, digits: 2 },
  },
  // tests[kind][scope][diffKey] = { best, plays, cleared, total }
  //   kind: "word" | "sent" | "custom" / scope: "stage-0"〜 | "shuffle" | "full" | "mistake"
  tests: { word: {}, sent: {}, custom: {}, num: {} },
  // ステージが解放された日: stageStarted[kind][stageIndex] = "YYYY-MM-DD"
  stageStarted: { word: {}, sent: {}, custom: {}, num: {} },
  // 間違えた問題: mistakes[kind][itemId] = 間違えた回数（復習テストで正解すると卒業＝削除）
  mistakes: { word: {}, sent: {}, custom: {}, num: {} },
  // 大型のお祝いを一度だけ出すためのフラグ
  celebrated: { word: false, sent: false, num: false, grand: false },
};

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_STATE,
        ...parsed,
        studyLog: parsed.studyLog || {},
        tests: { word: {}, sent: {}, custom: {}, num: {}, ...(parsed.tests || {}) },
        stageStarted: { word: {}, sent: {}, custom: {}, num: {}, ...(parsed.stageStarted || {}) },
        mistakes: { word: {}, sent: {}, custom: {}, num: {}, ...(parsed.mistakes || {}) },
        celebrated: { ...DEFAULT_STATE.celebrated, ...(parsed.celebrated || {}) },
        settings: {
          ...DEFAULT_STATE.settings,
          ...(parsed.settings || {}),
          learnPrefs: { ...DEFAULT_STATE.settings.learnPrefs, ...((parsed.settings || {}).learnPrefs || {}) },
          testPrefs: { ...DEFAULT_STATE.settings.testPrefs, ...((parsed.settings || {}).testPrefs || {}) },
          numTestPrefs: { ...DEFAULT_STATE.settings.numTestPrefs, ...((parsed.settings || {}).numTestPrefs || {}) },
        },
        customItems: parsed.customItems || [],
      };
    }
    // v1 からの移行（学習日・ポイント・音読回数を引き継ぐ）
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const p = JSON.parse(legacy);
      return {
        ...DEFAULT_STATE,
        studyDays: p.studyDays || [],
        totalPoints: p.totalPoints || 0,
        wordShadow: p.wordShadow || {},
        sentShadow: p.sentShadow || {},
      };
    }
    return DEFAULT_STATE;
  } catch (e) {
    return DEFAULT_STATE;
  }
}

function useAppState() {
  const [state, setState] = useState(loadState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage が使えない実行環境。学習データはこのセッション中のみメモリに保持される。
    }
  }, [state]);

  const update = useCallback((updater) => {
    setState((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  return [state, update];
}

// 学習日を記録（種類kindを渡すとその日の種類ドット用にstudyLogにも記録）
const withStudyDayMarked = (prev, kind) => {
  const k = todayKey();
  const already = prev.studyDays.includes(k);
  let studyLog = prev.studyLog;
  // custom（マイリスト）はカレンダーの色分け対象外
  if (kind && kind !== "custom") {
    const day = prev.studyLog[k] || {};
    if (!day[kind]) studyLog = { ...prev.studyLog, [k]: { ...day, [kind]: true } };
  }
  if (already && studyLog === prev.studyLog) return prev;
  return {
    ...prev,
    studyDays: already ? prev.studyDays : [...prev.studyDays, k],
    studyLog,
  };
};
// 学習画面・テスト画面の設定を保存（次回も同じ設定を表示するため）
const withLearnPrefs = (prev, patch) => ({
  ...prev,
  settings: { ...prev.settings, learnPrefs: { ...prev.settings.learnPrefs, ...patch } },
});
const withTestPrefs = (prev, patch) => ({
  ...prev,
  settings: { ...prev.settings, testPrefs: { ...prev.settings.testPrefs, ...patch } },
});
const withNumTestPrefs = (prev, patch) => ({
  ...prev,
  settings: { ...prev.settings, numTestPrefs: { ...prev.settings.numTestPrefs, ...patch } },
});
const withPoints = (prev, n) => ({ ...prev, totalPoints: prev.totalPoints + n });
const SHADOW_KEYS = { word: "wordShadow", sent: "sentShadow", custom: "customShadow", num: "numShadow" };
const withShadow = (prev, kind, id) => {
  const k = SHADOW_KEYS[kind];
  return { ...prev, [k]: { ...prev[k], [id]: (prev[k][id] || 0) + 1 } };
};
// ステージ全項目にまとめて+1（セット再生後の「全部シャドーイングした！」ボタン用）
const withShadowBulk = (prev, kind, ids) => {
  const k = SHADOW_KEYS[kind];
  const m = { ...prev[k] };
  ids.forEach((id) => {
    m[id] = (m[id] || 0) + 1;
  });
  return { ...prev, [k]: m };
};
const withUnlockMode = (prev, mode) => ({ ...prev, settings: { ...prev.settings, unlockMode: mode } });
const withCustomItemAdded = (prev, item) => ({ ...prev, customItems: [...prev.customItems, item] });
const withCustomItemsAdded = (prev, items) => ({ ...prev, customItems: [...prev.customItems, ...items] });
const withCustomItemRemoved = (prev, id) => {
  const shadow = { ...prev.customShadow };
  delete shadow[id];
  const mistakes = { ...prev.mistakes.custom };
  delete mistakes[id];
  return {
    ...prev,
    customItems: prev.customItems.filter((it) => it.id !== id),
    customShadow: shadow,
    mistakes: { ...prev.mistakes, custom: mistakes },
  };
};

// テスト結果を難易度別に記録（自己ベスト更新・全問正解でその難易度をクリア扱いに）
const withTestRecord = (prev, kind, scope, diffKey, score, total) => {
  const kindTests = prev.tests[kind] || {};
  const scopeRec = kindTests[scope] || {};
  const old = scopeRec[diffKey] || { best: 0, plays: 0, cleared: false, total };
  const next = {
    best: Math.max(old.best, score),
    plays: (old.plays || 0) + 1,
    cleared: old.cleared || score === total,
    total,
  };
  return {
    ...prev,
    tests: { ...prev.tests, [kind]: { ...kindTests, [scope]: { ...scopeRec, [diffKey]: next } } },
  };
};

const withMistake = (prev, kind, id) => ({
  ...prev,
  mistakes: {
    ...prev.mistakes,
    [kind]: { ...prev.mistakes[kind], [id]: (prev.mistakes[kind][id] || 0) + 1 },
  },
});

// 復習テストで正解した問題は間違いリストから卒業
const withMistakeCleared = (prev, kind, id) => {
  const m = { ...prev.mistakes[kind] };
  delete m[id];
  return { ...prev, mistakes: { ...prev.mistakes, [kind]: m } };
};

const withCelebrated = (prev, key) => ({
  ...prev,
  celebrated: { ...prev.celebrated, [key]: true },
});

/* ---- 学習記録のリセット ----
 * 一度クリアした人が、家族などに最初からやってもらいたいときに使う。
 * 種類別（単語 / 例文 / 数字）は、その種類の音読回数・テスト記録・間違いリスト・お祝いフラグだけを消す。
 * ポイントや学習カレンダー、設定（速度など）はそのまま残す。
 */
const withKindReset = (prev, kinds) => {
  const next = {
    ...prev,
    tests: { ...prev.tests },
    stageStarted: { ...prev.stageStarted },
    mistakes: { ...prev.mistakes },
    celebrated: { ...prev.celebrated },
  };
  kinds.forEach((kind) => {
    next[SHADOW_KEYS[kind]] = {}; // 音読回数
    next.tests[kind] = {};        // テスト記録（ステージ進行もこれで戻る）
    next.stageStarted[kind] = {};
    next.mistakes[kind] = {};
    if (kind in next.celebrated) next.celebrated[kind] = false;
  });
  // 「単語＋例文の全制覇」お祝いは、単語か例文を戻したときだけ未達成に戻す
  // （数字だけ戻したときに再びお祝いとボーナスが出てしまうのを防ぐ）
  if (kinds.includes("word") || kinds.includes("sent")) next.celebrated.grand = false;
  return next;
};

// すべてリセット（ポイント・学習カレンダーも含めて初期状態に戻す。設定とマイリストは維持）
const withFullReset = (prev) => ({
  ...DEFAULT_STATE,
  settings: prev.settings,
  customItems: prev.customItems,
});

/* =========================================================================
 * ステージ進行の計算
 *  - クリア条件: 各項目を SHADOW_REQUIRED 回以上音読 ＋ ステージテスト全問正解（難易度は問わない）
 * ======================================================================= */

function computeStages(kind, items, state, { alwaysUnlocked = false, chunks = null, testLevels = 0 } = {}) {
  const stageChunks = chunks || chunk(items, CONFIG.STAGE_SIZE);
  const shadowMap = state[SHADOW_KEYS[kind]] || {};
  const tests = state.tests[kind] || {};
  const started = state.stageStarted[kind] || {};
  const unlockMode = (state.settings && state.settings.unlockMode) || "test";

  const list = stageChunks.map((stItems, i) => {
    const shadowDone = stItems.filter((it) => (shadowMap[it.id] || 0) >= CONFIG.SHADOW_REQUIRED).length;
    // 各項目を QUICK_UNLOCK_SHADOW_PER_ITEM 回以上音読した項目数（テストなし解放の判定用）
    const shadowDeep = stItems.filter((it) => (shadowMap[it.id] || 0) >= CONFIG.QUICK_UNLOCK_SHADOW_PER_ITEM).length;

    // 3段階テスト構成（数字用）: t1=自分で言えるかチェック / t2=練習した問題のテスト / t3=ランダムテスト
    if (testLevels === 3) {
      const lv = [1, 2, 3].map((n) => {
        const rec = tests[`stage-${i}-t${n}`] || {};
        const vals = Object.values(rec);
        return {
          records: rec,
          best: vals.reduce((m, r) => Math.max(m, r.best || 0), 0),
          cleared: vals.some((r) => r.cleared),
        };
      });
      const shadowOk = shadowDone >= stItems.length;
      // ステージ1（1〜20）は練習した問題＝範囲全体なので、テスト3（ランダム）を置くと内容が重複する。
      // そのためステージ1のみテスト2が最終テストになる。
      const hasLevel3 = i > 0;
      const lastLevel = hasLevel3 ? lv[2] : lv[1];
      return {
        index: i,
        items: stItems,
        shadowDone,
        shadowTotal: stItems.length,
        shadowDeep,
        levels: lv,
        hasLevel3,
        // 各テストの解放: 音読完了でt1 → t1合格でt2 → t2合格でt3
        //（開発者モードでは全部解放してチェックできるようにする）
        levelUnlocked: alwaysUnlocked ? [true, true, true] : [shadowOk, lv[0].cleared, lv[1].cleared],
        best: lastLevel.best,
        cleared: lastLevel.cleared, // ステージクリア＝そのステージの最終テスト合格
        records: lastLevel.records,
        startedOn: started[i] || null,
      };
    }

    const records = tests[`stage-${i}`] || {};
    const recValues = Object.values(records);
    const best = recValues.reduce((m, r) => Math.max(m, r.best || 0), 0);
    const cleared = recValues.some((r) => r.cleared);
    return {
      index: i,
      items: stItems,
      shadowDone,
      shadowTotal: stItems.length,
      shadowDeep,
      best,
      cleared,
      records,
      startedOn: started[i] || null,
    };
  });

  list.forEach((st, i) => {
    if (i === 0 || alwaysUnlocked) {
      st.unlocked = true;
      st.prevStage = i > 0 ? list[i - 1] : null;
      return;
    }
    const prev = list[i - 1];
    // 解放条件: 前ステージの音読（各3回以上）＋テスト全問正解
    const prevDone = prev.cleared && prev.shadowDone >= prev.shadowTotal;
    // 「音読だけで解放」モード: テスト未合格でも、前ステージの全項目を各 QUICK_UNLOCK_SHADOW_PER_ITEM 回以上音読したら解放
    const quick =
      unlockMode === "shadow" && prev.shadowTotal > 0 && prev.shadowDeep >= prev.shadowTotal;
    st.unlocked = prevDone || quick;
    st.prevStage = prev;
  });

  return list;
}

/* =========================================================================
 * 音声再生フック（Web Speech API。非対応時はタイミングを再現するダミー再生）
 * ======================================================================= */

const VOICE_PREF_KEY = "ear100_test_voice_uri_v1"; // テスト版専用キー

/* ---- 録音音声（MP3）再生 ----
 * item.audio が指定されている項目は、Web Speech API の代わりに録音音声を再生する。
 * 目的: どの端末でも同じ声・同じ速さ・同じ間隔で聞こえるようにする（本番の講師録音MP3の先行検証）。
 *
 * 再生方式は3段フォールバック:
 *  1. Web Audio API（最優先）… 事前デコード済みバッファをサンプル精度で再生。開始遅延ほぼゼロで
 *     デバイス差が出ない。倍速はピッチが変わってしまうため、速度別に事前生成したファイル
 *     （w1_sit_050.mp3 〜 w1_sit_200.mp3 のような _NNN サフィックス）を等速で再生する。
 *  2. HTMLAudioElement … バッファ未読み込み時のつなぎ。1.0x版ファイル + playbackRate で再生。
 *  3. TTS（Web Speech API）… 音声ファイル自体が読めない環境（チャットプレビュー等）用。
 */
// 音声ファイルの場所（ページURLからの相対パス。index.htmlと同じルート直下に置く）
const AUDIO_BASE = "./";

// 速度→ファイル名サフィックスの対応（例: 1.5x → w1_sit_150.mp3）
const SPEED_FILE_CODES = { "0.5": "050", "0.7": "070", "1.0": "100", "1.5": "150", "2.0": "200" };
function audioVariantFile(file, rate) {
  const code = SPEED_FILE_CODES[Number(rate).toFixed(1)];
  return code ? file.replace(/\.mp3$/i, `_${code}.mp3`) : null;
}

// --- 数字パーツ（スプライト方式）---
// 203パーツ×4速度を、速度ごとに1本のスプライトMP3（nums_070.mp3 等）にまとめ、
// 各パーツの位置を nums_pos_070.json 等に記録してある。アプリはスプライトを1回デコードして
// AudioBuffer にし、各パーツはその中の [start_ms, dur_ms] を切り出して個別バッファ化する。
// 利点: 配布ファイルが 812個 → 8個（MP3 4本 + JSON 4本）。単語・例文MP3と同じルート直下にフラット配置。
// 音質・速度・タイミングは個別ファイル方式と同一（同じ atempo 音源を切り出すだけ・Web Audioで同じ再生）。
const NUM_PARTS_BASE = "";
const NUM_SPEED_FILE_CODES = { "0.7": "070", "1.0": "100", "1.5": "150", "2.0": "200" };
function numSpeedCode(rate) {
  return NUM_SPEED_FILE_CODES[Number(rate).toFixed(1)] || "100"; // 未対応速度は等速へ
}

// --- 特典（数字パート）スプライト: extras ---
// 時計・お金・チップ・電話の録音パーツは nums とは別スプライト（extras_100.mp3 + extras_pos_100.json）に入っている。
// 当面は 1倍速（extras_100）のみ用意（速度別は ZOOM後に atempo 生成）。
const EXTRAS_ONLY_CODE = "100";
// part ID の接頭辞でどのスプライト・ファミリーに属するか判定する。
//   extras: xoh_ / dig_ / oclock_ / dollars_ / pct_ / p??_(電話ブロック)
//   nums  : cont_ / term_ / thousand_* / hundred_* / zero
function partSpriteFamily(pid) {
  return /^(xoh_|dig_|oclock_|dollars_|pct_|p\d)/.test(pid) ? "extras" : "nums";
}
// スプライトのファミリー×速度で使う実効code（extras は速度に関わらず常に 100）。
function spriteCodeFor(family, rate) {
  return family === "extras" ? EXTRAS_ONLY_CODE : numSpeedCode(rate);
}

// `${family}_${code}` → { buffer: AudioBuffer(スプライト全体), pos: {pid:{start_ms,dur_ms}} , loading: bool }
const numSprites = new Map();
// 切り出し済み個別パーツバッファのキャッシュ: `${pid}|${code}` → AudioBuffer（pid は family 非衝突なのでこれで一意）
const numPartBufferCache = new Map();

// スプライト（指定 family・code）を読み込む。MP3とJSONを取得してデコード・保持する。
// mp3 = `${family}_${code}.mp3` / json = `${family}_pos_${code}.json`（nums/extras 共通の命名）。
function loadNumSprite(code, family = "nums") {
  const ctx = getAudioCtx();
  if (!ctx || typeof fetch === "undefined") return;
  const sKey = `${family}_${code}`;
  if (numSprites.has(sKey)) return; // 既に読み込み中/済み
  const entry = { buffer: null, pos: null, loading: true };
  numSprites.set(sKey, entry);
  const mp3 = `${NUM_PARTS_BASE}${family}_${code}.mp3`;
  const jsonf = `${NUM_PARTS_BASE}${family}_pos_${code}.json`;
  Promise.all([
    fetch(AUDIO_BASE + mp3).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then((ab) => ctx.decodeAudioData(ab)),
    fetch(AUDIO_BASE + jsonf).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  ])
    .then(([buf, meta]) => {
      entry.buffer = buf;
      entry.pos = meta.positions || {};
      entry.loading = false;
    })
    .catch(() => {
      numSprites.delete(sKey); // 失敗したら消す（TTSフォールバックさせる）
    });
}
// 数字パーツのプリロード。使う速度分の nums スプライトを読み込むだけ（パーツ単位のfetchは不要）。
// numberItems は互換のため受け取るが、スプライトは全パーツ入りなので speeds だけ見る。
function preloadNumberParts(numberItems, speeds) {
  (speeds || []).forEach((sp) => loadNumSprite(numSpeedCode(sp), "nums"));
}
// 特典モジュール用: extras（＋端数用の nums 100）スプライトを先読みする。
function preloadExtrasParts() {
  loadNumSprite(EXTRAS_ONLY_CODE, "extras");
  loadNumSprite("100", "nums"); // 時計H:MM・価格D.CC の cont_/term_ 用（1倍）
}
// 1パーツの、指定速度のデコード済みバッファを返す。スプライトから切り出してキャッシュする。
// 切り出し境界には 3ms のマイクロフェードを掛けて、MP3端のプツッというノイズを防ぐ。
function getNumberPartBuffer(partId, rate) {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  const family = partSpriteFamily(partId);
  const code = spriteCodeFor(family, rate);
  const key = `${partId}|${code}`;
  const cached = numPartBufferCache.get(key);
  if (cached) return cached;
  const sprite = numSprites.get(`${family}_${code}`);
  if (!sprite) {
    loadNumSprite(code, family); // まだ無ければ読み込みを仕掛ける
    return null;
  }
  if (!sprite.buffer || !sprite.pos) return null; // 読み込み中
  const p = sprite.pos[partId];
  if (!p) return null; // 位置情報に無いパーツ
  const sr = sprite.buffer.sampleRate;
  const start = Math.max(0, Math.round((p.start_ms / 1000) * sr));
  const len = Math.round((p.dur_ms / 1000) * sr);
  if (len <= 0) return null;
  const src = sprite.buffer.getChannelData(0);
  const end = Math.min(src.length, start + len);
  const out = ctx.createBuffer(1, end - start, sr);
  const dst = out.getChannelData(0);
  dst.set(src.subarray(start, end));
  // 3ms マイクロフェード（切り出し境界のクリック防止）
  const nf = Math.min(Math.floor(0.003 * sr), Math.floor(dst.length / 2));
  for (let i = 0; i < nf; i++) {
    const g = i / nf;
    dst[i] *= g;
    dst[dst.length - 1 - i] *= g;
  }
  numPartBufferCache.set(key, out);
  return out;
}
// 数字パーツ列が「全パーツ切り出し可能か」を確認（1つでも欠けたら連結再生せずTTSへ）。
function allNumberPartsReady(parts, rate) {
  if (!parts || parts.length === 0) return false;
  return parts.every((pid) => !!getNumberPartBuffer(pid, rate));
}

// --- Web Audio API（方式1） ---
let webAudioCtx = null;
function getAudioCtx() {
  if (webAudioCtx) return webAudioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    webAudioCtx = new AC();
  } catch (e) {
    return null;
  }
  return webAudioCtx;
}
// variantファイル名 → デコード済みAudioBuffer（null=読み込み中）
const webAudioBuffers = new Map();
function preloadWebAudioBuffers(items, speeds) {
  const ctx = getAudioCtx();
  if (!ctx || typeof fetch === "undefined") return;
  items.forEach((it) => {
    if (!it.audio) return;
    speeds.forEach((sp) => {
      const vf = audioVariantFile(it.audio, sp);
      if (!vf || webAudioBuffers.has(vf)) return;
      webAudioBuffers.set(vf, null); // 読み込み中マーク（重複fetch防止）
      fetch(AUDIO_BASE + vf)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => webAudioBuffers.set(vf, buf))
        .catch(() => webAudioBuffers.delete(vf)); // 失敗したら消す（HTMLAudio/TTSにフォールバックさせる）
    });
  });
}
function countLoadedBuffers() {
  let n = 0;
  webAudioBuffers.forEach((b) => {
    if (b) n += 1;
  });
  return n;
}

// --- HTMLAudioElement（方式2・フォールバック） ---
const audioCache = new Map();
function getAudioEl(file) {
  if (!audioCache.has(file)) {
    const a = new Audio(AUDIO_BASE + file);
    a.preload = "auto"; // 事前読み込みでテスト時の反応を良くする
    audioCache.set(file, a);
  }
  return audioCache.get(file);
}
// アプリ起動時にフォールバック用の1.0x版をまとめてプリロードする
function preloadAudio(items) {
  items.forEach((it) => {
    if (it.audio) getAudioEl(audioVariantFile(it.audio, 1.0) || it.audio);
  });
}

// 「英語っぽいボイス」を上位に並べる簡易スコアリング。
// Google/Microsoft の高品質なオンライン音声は rate（速度）変更にもきちんと追従するため優先する。
function scoreVoiceQuality(v) {
  const name = (v.name || "").toLowerCase();
  let score = 0;
  if (v.lang === "en-US") score += 3;
  else if ((v.lang || "").toLowerCase().startsWith("en")) score += 2;
  if (name.includes("google")) score += 2;
  if (name.includes("natural") || name.includes("online") || name.includes("premium")) score += 2;
  if (!v.localService) score += 1; // オンライン音声は高品質なことが多い
  return score;
}

function useSpeech() {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined";

  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURIState] = useState(() => {
    try {
      return window.localStorage.getItem(VOICE_PREF_KEY) || null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    if (!supported) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  // 英語として読み上げ可能な音声だけを厳密に抽出（lang が en* のものだけ。日本語音声は絶対に含めない）
  const englishVoices = useMemo(() => {
    return [...voices]
      .filter((v) => (v.lang || "").toLowerCase().startsWith("en"))
      .sort((a, b) => scoreVoiceQuality(b) - scoreVoiceQuality(a));
  }, [voices]);

  // ユーザーがまだ選択していない場合は、最もスコアの高い英語音声を自動選択する
  useEffect(() => {
    if (voiceURI) return;
    if (englishVoices.length === 0) return;
    setVoiceURIState(englishVoices[0].voiceURI);
  }, [englishVoices, voiceURI]);

  const setVoiceURI = useCallback((uri) => {
    setVoiceURIState(uri);
    try {
      window.localStorage.setItem(VOICE_PREF_KEY, uri);
    } catch (e) {
      /* noop */
    }
  }, []);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === voiceURI) || null,
    [voices, voiceURI]
  );

  // 再生中の録音音声（Web Audioソース / HTMLAudio要素）を追跡して停止できるようにする
  const currentSourceRef = useRef(null);
  const currentAudioRef = useRef(null);
  // 数字パーツ連結再生では複数の BufferSource を同時に予約するため、配列で全部追跡する
  const currentSourcesRef = useRef([]);
  const stopAudio = useCallback(() => {
    const s = currentSourceRef.current;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch (e) {
        /* noop */
      }
      currentSourceRef.current = null;
    }
    // 数字パーツの連結再生で予約済みの全ソースを停止
    const list = currentSourcesRef.current;
    if (list && list.length) {
      list.forEach((src) => {
        if (!src) return;
        src.onended = null;
        try {
          src.stop();
        } catch (e) {
          /* noop */
        }
      });
      currentSourcesRef.current = [];
    }
    const a = currentAudioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      try {
        a.pause();
      } catch (e) {
        /* noop */
      }
      currentAudioRef.current = null;
    }
  }, []);

  // target には文字列（従来どおりTTS）または項目オブジェクト { en, ja, audio? } を渡せる。
  // audio が指定されていれば録音MP3を再生し、なければ従来どおり Web Speech API を使う。
  const speak = useCallback(
    (target, opts = {}) => {
      const item = typeof target === "string" ? { en: target } : target || { en: "" };
      const text = item.en || "";
      const { rate = 1, onstart, onend } = opts;
      stopAudio();

      // TTS（Web Speech API）での再生。録音音声が使えない環境ではこちらにフォールバックする
      const ttsSpeak = () => {
        if (supported) {
          try {
            const utter = new window.SpeechSynthesisUtterance(text);
            // 重要: 英語と確認できた音声しか utter.voice にセットしない。
            // 該当する音声が一つもない場合は voice を指定せず lang だけ渡す
            // （日本語音声で英語を読ませる＝カタカナ英語になる事故を避けるため）。
            if (selectedVoice && (selectedVoice.lang || "").toLowerCase().startsWith("en")) {
              utter.voice = selectedVoice;
              utter.lang = selectedVoice.lang;
            } else {
              utter.lang = "en-US";
            }
            utter.rate = rate;
            utter.onstart = () => onstart && onstart();
            utter.onend = () => onend && onend();
            utter.onerror = () => onend && onend();
            window.speechSynthesis.speak(utter);
            return;
          } catch (e) {
            // フォールバックへ
          }
        }
        // ダミー再生: 文字数からおおよその発話時間を見積もって onend を呼ぶ
        onstart && onstart();
        const baseMs = Math.max(500, text.split(" ").length * 320);
        window.setTimeout(() => onend && onend(), baseMs / rate);
      };

      // 数字パーツ連結再生（item.parts がある = makeNumberSpeakTarget 由来）。
      // 各パーツを Web Audio で ctx.currentTime 基準に間0ms（butt join）で連続 start する。
      // 全パーツがそろっていない場合は連結せず TTS（en）にフォールバックする。
      if (item.parts && item.parts.length) {
        const ctx = getAudioCtx();
        if (ctx && allNumberPartsReady(item.parts, rate)) {
          try {
            if (ctx.state === "suspended") ctx.resume();
            const sources = [];
            let t = ctx.currentTime + 0.03; // わずかな先出しでスケジューリングの取りこぼしを防ぐ
            let lastSrc = null;
            // 通常は間0ms（butt join）。item.partGaps があれば各パーツの後に指定秒の無音を挟む（電話の3-3-4グループ間0.32s用）。
            const gaps = item.partGaps;
            item.parts.forEach((pid, pi) => {
              const buf = getNumberPartBuffer(pid, rate);
              if (!buf) return;
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(ctx.destination);
              src.start(t);
              t += buf.duration + (gaps ? (gaps[pi] || 0) : 0);
              sources.push(src);
              lastSrc = src;
            });
            currentSourcesRef.current = sources;
            if (lastSrc) {
              lastSrc.onended = () => {
                // このバッチが現行のものであれば完了通知＆クリア
                if (currentSourcesRef.current === sources) currentSourcesRef.current = [];
                onend && onend();
              };
            }
            onstart && onstart();
            return;
          } catch (e) {
            // 失敗したら TTS へ
          }
        }
        // パーツが未ロード or 再生失敗 → TTS フォールバック（en を読む）
        ttsSpeak();
        return;
      }

      if (item.audio) {
        // 方式1: Web Audio API（速度別バッファ）。開始遅延ほぼゼロ・全デバイス同一タイミング
        const ctx = getAudioCtx();
        const vf = audioVariantFile(item.audio, rate);
        const buf = vf ? webAudioBuffers.get(vf) : null;
        if (ctx && buf) {
          try {
            if (ctx.state === "suspended") ctx.resume(); // 初回はユーザー操作起点なのでresume可能
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            currentSourceRef.current = src;
            src.onended = () => {
              if (currentSourceRef.current === src) currentSourceRef.current = null;
              onend && onend();
            };
            onstart && onstart();
            src.start(0);
            return;
          } catch (e) {
            // 方式2へフォールバック
          }
        }
        // 方式2: HTMLAudioElement（バッファ未読み込み時のつなぎ。1.0x版 + playbackRate）
        try {
          const a = getAudioEl(audioVariantFile(item.audio, 1.0) || item.audio);
          currentAudioRef.current = a;
          let settled = false;
          // 読み込み失敗（404等）や再生ブロック時はTTSにフォールバック
          const fail = () => {
            if (settled) return;
            settled = true;
            a.onended = null;
            a.onerror = null;
            if (currentAudioRef.current === a) currentAudioRef.current = null;
            ttsSpeak();
          };
          a.onended = () => {
            if (settled) return;
            settled = true;
            if (currentAudioRef.current === a) currentAudioRef.current = null;
            onend && onend();
          };
          a.onerror = fail;
          a.currentTime = 0;
          a.playbackRate = rate;
          if ("preservesPitch" in a) a.preservesPitch = true; // 倍速でも声のピッチを維持
          onstart && onstart();
          a.play().catch(fail);
          return;
        } catch (e) {
          // 録音再生に失敗した場合はTTSにフォールバック
        }
      }

      ttsSpeak();
    },
    [supported, selectedVoice, stopAudio]
  );

  const cancel = useCallback(() => {
    stopAudio(); // 録音音声も止める
    if (supported) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* noop */
      }
    }
  }, [supported, stopAudio]);

  // 設定済みの SpeechSynthesisUtterance を生成するヘルパー。
  // speechSynthesis.speak() に複数まとめて積むことで JS ラウンドトリップなしの連続再生が可能。
  const makeUtterance = useCallback(
    (text, rate = 1) => {
      if (!supported) return null;
      try {
        const utter = new window.SpeechSynthesisUtterance(text);
        if (selectedVoice && (selectedVoice.lang || "").toLowerCase().startsWith("en")) {
          utter.voice = selectedVoice;
          utter.lang = selectedVoice.lang;
        } else {
          utter.lang = "en-US";
        }
        utter.rate = rate;
        return utter;
      } catch (e) {
        return null;
      }
    },
    [supported, selectedVoice]
  );

  return {
    speak,
    cancel,
    makeUtterance,
    supported,
    voices,
    englishVoices,
    voiceURI,
    setVoiceURI,
    selectedVoice,
    hasEnglishVoice: englishVoices.length > 0,
  };
}

/* =========================================================================
 * 共通 UI パーツ
 * ======================================================================= */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

      :root {
        --bg-grad: linear-gradient(180deg, #EEF5F8 0%, #F6F2FC 100%);
        --card: #FFFFFF;
        --ink: #16202B;
        --ink-soft: #5C6B76;
        --line: #DCE6EA;
        --bg-soft: #EEF1F4;
        --coral: #F1473B;
        --coral-dark: #C73B31;
        --coral-soft: #FFE4E1;
        --indigo: #5B53F2;
        --indigo-soft: #EBEAFD;
        --mint: #0FA37D;
        --mint-soft: #DCFBF0;
        --amber: #D6852A;
        --amber-soft: #FDF0DA;
        --red: #D9363E;
        --red-soft: #FDE7E8;
        --gold: #E0A82E;
      }

      .font-display { font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif; }
      .font-body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
      .font-mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; }

      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      @keyframes eqPulse { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
      .eq-bar { animation: eqPulse 0.9s ease-in-out infinite; }

      @keyframes popIn { 0% { transform: scale(0.96); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      .animate-pop { animation: popIn 0.25s ease-out; }

      @keyframes floatUp { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
      .animate-floatup { animation: floatUp 0.6s ease-out forwards; }

      @keyframes confettiFall {
        0% { transform: translateY(-8vh) rotate(0deg); opacity: 1; }
        100% { transform: translateY(108vh) rotate(720deg); opacity: 0.65; }
      }
      .confetti-piece {
        position: fixed;
        top: 0;
        pointer-events: none;
        z-index: 70;
        animation-name: confettiFall;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
      }

      @keyframes trophyPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
      .trophy-pulse { animation: trophyPulse 1.1s ease-in-out infinite; }

      button { font-family: inherit; }
      *:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }

      @media (prefers-reduced-motion: reduce) {
        .eq-bar { animation: none; transform: scaleY(0.7); }
        .animate-pop { animation: none; }
        .animate-bounce { animation: none; }
        .animate-floatup { animation: none; opacity: 0; }
        .confetti-piece { animation: none; opacity: 0; }
        .trophy-pulse { animation: none; }
      }
    `}</style>
  );
}

// シグネチャ要素: 「聞く」アプリであることを示すイコライザーバー
function EqualizerBars({ active = true, size = 16, barCount = 4, color = "var(--coral)" }) {
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: size }} aria-hidden="true">
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          className={active ? "eq-bar" : ""}
          style={{
            display: "inline-block",
            width: Math.max(2, Math.round(size / 6)),
            height: "100%",
            backgroundColor: color,
            borderRadius: 2,
            transformOrigin: "bottom center",
            animationDelay: `${i * 0.12}s`,
            transform: active ? undefined : "scaleY(0.4)",
          }}
        />
      ))}
    </span>
  );
}

// クイズの回答タイマーをVUメーター風に可視化（シグネチャ要素の応用）
function CountdownBars({ remainingMs, totalMs = 4000, segments = 18 }) {
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
  const lit = Math.ceil(frac * segments);
  const color = frac <= 0.25 ? "var(--red)" : frac <= 0.5 ? "var(--amber)" : "var(--indigo)";
  return (
    <div className="flex items-end gap-[3px] h-8 w-full" aria-hidden="true">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm transition-colors duration-150"
          style={{
            height: "100%",
            backgroundColor: i < lit ? color : "var(--line)",
          }}
        />
      ))}
    </div>
  );
}

function Card({ children, className = "", active = false, activeColor = "var(--coral)" }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ backgroundColor: "var(--card)", border: `1px solid ${active ? activeColor : "var(--line)"}` }}
    >
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold font-mono transition-colors"
      style={{ backgroundColor: active ? "var(--indigo)" : "var(--bg-soft)", color: active ? "#fff" : "var(--ink-soft)" }}
    >
      {children}
    </button>
  );
}

function ControlGroup({ label, icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
        <Icon size={14} />
        {label}
      </span>
      <div className="flex gap-1 flex-wrap">{children}</div>
    </div>
  );
}

function NoticeBanner({ text, tone = "amber" }) {
  const colors =
    tone === "red"
      ? { bg: "var(--red-soft)", fg: "var(--red)" }
      : { bg: "var(--amber-soft)", fg: "var(--amber)" };
  const Icon = tone === "red" ? AlertTriangle : Sparkles;
  return (
    <div
      className="rounded-xl px-4 py-2.5 text-xs flex items-start gap-2"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// 読み上げ音声の選択UI。英語として確認できた音声だけを選択肢に出す。
function VoiceSettings({ supported, voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice }) {
  if (!supported) return null;
  if (voices.length === 0) {
    return <NoticeBanner text="この端末の読み上げ音声を読み込み中です…うまく再生されない場合は一度ページを再読み込みしてください。" />;
  }

  if (!hasEnglishVoice) {
    return (
      <NoticeBanner
        tone="red"
        text={
          "この端末に英語の読み上げ音声が見つかりませんでした。英語以外の音声で代用すると発音が不自然になり、" +
          "再生速度の変更が効かないことがあります。OSに英語音声を追加してください（Windows: 設定 > 時刻と言語 > 音声認識 > 音声の追加 / " +
          "Mac: システム設定 > アクセシビリティ > 読み上げコンテンツ > システムの声 / iPhone: 設定 > アクセシビリティ > 読み上げコンテンツ > 声 / " +
          "Android・Chromebook: 設定 > テキスト読み上げの出力 から言語パックを追加）。"
        }
      />
    );
  }

  return (
    <Card className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="flex items-center gap-1.5 text-xs font-medium shrink-0" style={{ color: "var(--ink-soft)" }}>
        <Mic size={14} /> 読み上げ音声
      </span>
      <select
        value={voiceURI || ""}
        onChange={(e) => setVoiceURI(e.target.value)}
        className="flex-1 text-sm rounded-full px-3 py-2 border min-w-0"
        style={{ borderColor: "var(--line)", backgroundColor: "var(--bg-soft)", color: "var(--ink)" }}
      >
        {englishVoices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang}){!v.localService ? " ・オンライン" : ""}
          </option>
        ))}
      </select>
      <span className="text-[11px] shrink-0" style={{ color: "var(--ink-soft)" }}>
        発音が不自然/速度が変わらない時は他の音声も試してみてください
      </span>
    </Card>
  );
}

// デバッグ用診断パネル
function VoiceDiagnostics({ supported, voices, voiceURI }) {
  if (!supported) return null;
  return (
    <details className="rounded-xl text-xs" style={{ backgroundColor: "var(--bg-soft)", border: "1px solid var(--line)" }}>
      <summary className="cursor-pointer px-4 py-2 font-medium select-none" style={{ color: "var(--ink-soft)" }}>
        🔍 音声診断情報を見る（直らない場合はここを確認 / コピーして教えてください）
      </summary>
      <div className="px-4 pb-3 space-y-1">
        <p className="font-mono">
          Web Audio対応: {window.AudioContext || window.webkitAudioContext ? "あり" : "なし"} / 読み込み済み録音バッファ: {countLoadedBuffers()}件
          （バッファがあれば録音単語はWeb Audio方式＝端末差なしで再生されます）
        </p>
        <p className="font-mono">speechSynthesis 対応: {supported ? "あり" : "なし"}</p>
        <p className="font-mono">検出された音声の総数: {voices.length}</p>
        {voices.length === 0 && (
          <p className="font-mono" style={{ color: "var(--red)" }}>
            ⚠ 音声が1件も検出されていません。実行環境がブラウザの音声合成にアクセスできていない可能性があります（サンドボックス化されたプレビュー内など）。
          </p>
        )}
        {voices.length > 0 && (
          <ul className="space-y-0.5 font-mono">
            {voices.map((v) => (
              <li
                key={v.voiceURI}
                style={{ color: v.voiceURI === voiceURI ? "var(--indigo)" : "var(--ink-soft)" }}
              >
                {v.voiceURI === voiceURI ? "▶ " : "\u00A0\u00A0"}
                {v.name} — {v.lang} {v.localService ? "(ローカル)" : "(オンライン)"} {v.default ? "[既定]" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function PrimaryButton({ children, onClick, className = "", disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 ${className}`}
      style={{ backgroundColor: "var(--coral)" }}
    >
      {children}
    </button>
  );
}

function IndigoButton({ children, onClick, className = "", disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 ${className}`}
      style={{ backgroundColor: "var(--indigo)" }}
    >
      {children}
    </button>
  );
}

function DangerButton({ children, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform ${className}`}
      style={{ backgroundColor: "var(--red)" }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-full ${className}`}
      style={{ color: "var(--ink-soft)", backgroundColor: "var(--bg-soft)" }}
    >
      {children}
    </button>
  );
}

function ShadowButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold active:scale-95 transition-transform"
      style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
    >
      {children}
    </button>
  );
}

function ProgressBar({ value, max, color = "var(--mint)", height = 6 }) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-soft)", height }}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${frac * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, bg }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: bg, color }}>
          <Icon size={16} />
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
          {label}
        </span>
      </div>
      <p className="font-mono text-2xl font-bold">{value}</p>
    </Card>
  );
}

function QuickStartCard({ title, desc, cta, onClick, color }) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div>
        <h3 className="font-display font-semibold">{title}</h3>
        <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
          {desc}
        </p>
      </div>
      <button
        onClick={onClick}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-white w-fit active:scale-95 transition-transform"
        style={{ backgroundColor: color }}
      >
        {cta} <ChevronRight size={14} />
      </button>
    </Card>
  );
}

/* =========================================================================
 * お祝い演出（tier が上がるほど紙吹雪・メッセージが豪華になる）
 *  tier 1〜5: ステージ1〜5クリア / 6: 単語100 or 例文100 完全制覇 / 7: 全制覇
 * ======================================================================= */

const CONFETTI_COLORS = ["#F1473B", "#5B53F2", "#0FA37D", "#D6852A", "#E856B0", "#E0A82E"];

function Confetti({ count }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.9,
        dur: 2.2 + Math.random() * 1.8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 6 + Math.random() * 8,
      })),
    [count]
  );
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 0.45,
            backgroundColor: p.color,
            borderRadius: 2,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </>
  );
}

const TIER_STYLE = {
  1: { confetti: 14, emoji: "🎉", iconBg: "var(--mint-soft)", iconColor: "var(--mint)" },
  2: { confetti: 28, emoji: "🎉✨", iconBg: "var(--indigo-soft)", iconColor: "var(--indigo)" },
  3: { confetti: 44, emoji: "🎊🎉✨", iconBg: "var(--amber-soft)", iconColor: "var(--amber)" },
  4: { confetti: 64, emoji: "🏆🎊✨", iconBg: "var(--coral-soft)", iconColor: "var(--coral)" },
  5: { confetti: 90, emoji: "👑🏆🎊✨", iconBg: "var(--amber-soft)", iconColor: "var(--gold)" },
  6: { confetti: 130, emoji: "👑🌟🏆🎊🎉", iconBg: "var(--amber-soft)", iconColor: "var(--gold)" },
  7: { confetti: 210, emoji: "👑🌈🌟🏆🎊🎉✨", iconBg: "var(--amber-soft)", iconColor: "var(--gold)" },
};

function CelebrationModal({ tier = 1, title, message, points = 0, onClose, closeLabel = "つづける" }) {
  const style = TIER_STYLE[tier] || TIER_STYLE[1];
  const grand = tier >= 6;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(22,32,43,0.6)", backdropFilter: "blur(2px)" }}
    >
      <Confetti count={style.confetti} />
      <div
        className="rounded-3xl p-6 max-w-sm w-full text-center animate-pop"
        style={{
          backgroundColor: "var(--card)",
          border: grand ? "3px solid var(--gold)" : "1px solid var(--line)",
          boxShadow: grand ? "0 0 0 6px rgba(224,168,46,0.18), 0 18px 50px rgba(22,32,43,0.35)" : undefined,
        }}
      >
        <p className="text-2xl mb-2" aria-hidden="true">
          {style.emoji}
        </p>
        <div
          className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${grand ? "trophy-pulse" : "animate-bounce"}`}
          style={{ backgroundColor: style.iconBg }}
        >
          {grand ? (
            <PartyPopper size={30} style={{ color: style.iconColor }} />
          ) : (
            <Trophy size={28} style={{ color: style.iconColor }} />
          )}
        </div>
        <h2 className="font-display text-xl font-bold whitespace-pre-line">{title}</h2>
        {message && (
          <p className="text-sm mt-2" style={{ color: "var(--ink-soft)" }}>
            {message}
          </p>
        )}
        {points > 0 && (
          <p className="font-mono text-2xl font-bold mt-3" style={{ color: "var(--amber)" }}>
            +{points}pt
          </p>
        )}
        <div className="flex flex-col gap-2 mt-5">
          <PrimaryButton onClick={onClose} className="justify-center">
            <Sparkles size={16} /> {closeLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
 * 難易度別の達成度マトリクス（英文表示あり/なし × 速度）
 * ======================================================================= */

function DifficultyMatrix({ records = {} }) {
  const rows = [
    { show: true, label: "英文あり" },
    { show: false, label: "英文なし" },
  ];
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1 text-[11px] font-mono min-w-[280px]"
        style={{ gridTemplateColumns: `64px repeat(${CONFIG.TEST_SPEEDS.length}, minmax(44px, 1fr))` }}
      >
        <div />
        {CONFIG.TEST_SPEEDS.map((s) => (
          <div key={s} className="text-center font-semibold" style={{ color: "var(--ink-soft)" }}>
            {s.toFixed(1)}x
          </div>
        ))}
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <div className="flex items-center gap-1" style={{ color: "var(--ink-soft)" }}>
              {row.show ? <Eye size={12} /> : <EyeOff size={12} />}
              {row.label}
            </div>
            {CONFIG.TEST_SPEEDS.map((s) => {
              // (表示×速度) のセルに、回答時間違いの記録をまとめて表示する。
              // クリア済みなら「最短の回答時間」を出す（例: ✓2s ＝ 回答2秒でも全問正解済み）
              let bestSec = null;
              let bestScore = 0;
              let total = 0;
              Object.entries(records).forEach(([key, rec]) => {
                const d = parseDiffKey(key);
                if (d.show !== row.show || d.speed !== s) return;
                if (rec.cleared) bestSec = bestSec === null ? d.sec : Math.min(bestSec, d.sec);
                bestScore = Math.max(bestScore, rec.best || 0);
                total = rec.total || total;
              });
              const cleared = bestSec !== null;
              const tried = !cleared && bestScore > 0;
              return (
                <div
                  key={s}
                  className="rounded-md py-1 text-center"
                  style={{
                    backgroundColor: cleared ? "var(--mint-soft)" : "var(--bg-soft)",
                    color: cleared ? "var(--mint)" : tried ? "var(--amber)" : "var(--ink-soft)",
                    border: cleared ? "1px solid var(--mint)" : "1px solid transparent",
                  }}
                  title={
                    cleared
                      ? `この難易度で全問正解済み（最短回答時間 ${bestSec}秒）`
                      : tried
                      ? `自己ベスト ${bestScore}/${total}`
                      : "未挑戦"
                  }
                >
                  {cleared ? `✓${bestSec}s` : tried ? `${bestScore}` : "・"}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="text-[10px] mt-1" style={{ color: "var(--ink-soft)" }}>
        ✓n s=全問正解クリア（最短回答時間） / 数字=自己ベスト正解数 / ・=未挑戦
      </p>
    </div>
  );
}

/* =========================================================================
 * ナビゲーション
 * ======================================================================= */

const TABS = [
  { id: "dashboard", label: "ホーム", icon: LayoutDashboard },
  { id: "word", label: "単語", icon: BookOpen },
  { id: "sent", label: "例文", icon: MessageSquare },
  { id: "bonus", label: "特典", icon: Gift },
  // マイリストはCONFIG.SHOW_CUSTOMがtrueのときだけ表示（コードは残してある）
  ...(CONFIG.SHOW_CUSTOM ? [{ id: "custom", label: "マイリスト", icon: ListPlus }] : []),
];

// 各カテゴリ内の「学習｜テスト」切替セグメント
function SectionToggle({ section, setSection, color = "var(--indigo)" }) {
  const opts = [
    { id: "learn", label: "学習", icon: Headphones },
    { id: "test", label: "テスト", icon: ListChecks },
  ];
  return (
    <div
      className="inline-flex p-1 rounded-full gap-1"
      style={{ backgroundColor: "var(--bg-soft)", border: "1px solid var(--line)" }}
    >
      {opts.map((o) => {
        const Icon = o.icon;
        const active = section === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setSection(o.id)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors"
            style={{ backgroundColor: active ? color : "transparent", color: active ? "#fff" : "var(--ink-soft)" }}
          >
            <Icon size={15} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================================
 * 特典（数字パート）画面: 時計・お金モジュール
 *   承認済みデモ（tabi_stage_demo.html）の作りを移植。
 *   - 音読練習: 20問グリッド＋「20問を続けて再生」連続再生＋タップ個別再生
 *   - テスト3段階: t1=自分で言えるか / t2=練習した20問シャッフル / t3=未練習も混ぜてランダム
 *   - 最初から全開放。間違い時は自分の答え＋正解を並列表示。当面1倍のみ。
 *   進捗は非永続（デモ同様）。音声は speak(target)（extras/nums 自動判別で連結再生）。
 * ======================================================================= */
function fmtBonusAns(it, v1, v2) {
  if (it.type === "clock") return (v1 || "?") + ":" + (v2 !== "" && v2 != null ? pad2(v2) : "??");
  if (it.type === "price") return "$" + (v1 || "?") + "." + (v2 !== "" && v2 != null ? pad2(v2) : "??");
  if (it.type === "whole") return "$" + (v1 || "?");
  if (it.type === "tip") return (v1 || "?") + "%";
  if (it.type === "phone") return String(v1 || "").replace(/\D/g, "") || "?";
  return String(v1 || "?");
}
function checkBonus(it, v1, v2) {
  if (it.type === "clock") return +v1 === it.h && +v2 === it.m;
  if (it.type === "price") return +v1 === it.d && +v2 === it.c;
  if (it.type === "whole") return +v1 === it.d;
  if (it.type === "tip") return +v1 === it.x;
  if (it.type === "phone") return String(v1 || "").replace(/\D/g, "") === it.digits;
  return false;
}

// 時間・お金・電話の1カテゴリ。section（learn=音読 / test=テスト）で中身を切り替える。
// 学習/テストの切替は上位の SectionToggle が担う（内部にトグルは持たない＝両方テスト表示バグの解消）。
function BonusCat({ mod, section, speak, cancel, update }) {
  const cfg = BONUS_DATA[mod];
  return section === "test"
    ? <BonusTestHub mod={mod} speak={speak} cancel={cancel} update={update} />
    : <BonusShadow shadow={cfg.shadow} speak={speak} cancel={cancel} />;
}

// 音読練習: 20問グリッド＋連続再生
function BonusShadow({ shadow, speak, cancel }) {
  const [playingAll, setPlayingAll] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const cancelRef = useRef(false);

  const playOne = (it, idx) => {
    if (playingAll) return;
    cancel();
    setActiveIdx(idx);
    speak(bonusItemToTarget(it), { rate: 1.0, onend: () => setActiveIdx((v) => (v === idx ? -1 : v)) });
  };

  const stopAll = useCallback(() => {
    cancelRef.current = true;
    setPlayingAll(false);
    setActiveIdx(-1);
    cancel();
  }, [cancel]);

  const startAll = () => {
    cancelRef.current = false;
    setPlayingAll(true);
    let i = 0;
    const step = () => {
      if (cancelRef.current || i >= shadow.length) {
        setPlayingAll(false);
        setActiveIdx(-1);
        return;
      }
      const idx = i;
      setActiveIdx(idx);
      speak(bonusItemToTarget(shadow[idx]), {
        rate: 1.0,
        onend: () => {
          if (cancelRef.current) return;
          i += 1;
          // 項目間 150ms
          window.setTimeout(step, 150);
        },
      });
    };
    step();
  };

  useEffect(() => () => { cancelRef.current = true; }, []);

  const isPhone = shadow.length > 0 && shadow[0].type === "phone";
  const gridCls = isPhone ? "grid grid-cols-2 sm:grid-cols-3 gap-2" : "grid grid-cols-3 sm:grid-cols-4 gap-2";
  const cellText = isPhone ? "text-xs sm:text-sm" : "text-sm";

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-sm font-medium" style={{ color: "var(--ink-soft)" }}>
            タップで1問ずつ再生。まねして声に出そう。
          </p>
          {playingAll ? (
            <DangerButton onClick={stopAll}>
              <Square size={14} /> 停止
            </DangerButton>
          ) : (
            <ShadowButton onClick={startAll}>
              <Play size={13} /> {isPhone ? "続けて再生" : "20問を続けて再生"}
            </ShadowButton>
          )}
        </div>
        <div className={gridCls}>
          {shadow.map((it, idx) => {
            const on = activeIdx === idx;
            return (
              <button
                key={idx}
                onClick={() => playOne(it, idx)}
                className={`rounded-xl px-2 py-3 text-center font-mono font-semibold transition-colors active:scale-95 ${cellText}`}
                style={{
                  backgroundColor: on ? "var(--mint)" : "var(--bg-soft)",
                  color: on ? "#fff" : "var(--ink)",
                  border: `1px solid ${on ? "var(--mint)" : "var(--line)"}`,
                }}
              >
                {it.disp}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// テスト3段階のハブ（1→2→3の順に挑戦。合格で次へ進める）
function BonusTestHub({ mod, speak, cancel, update }) {
  const [level, setLevel] = useState(0); // 0=一覧 / 1|2|3
  if (level === 0) {
    return (
      <Card className="p-4 space-y-2">
        <p className="text-xs mb-1" style={{ color: "var(--ink-soft)" }}>
          テスト1から順に挑戦。合格すると次のテストへ進めます（いつでも選べます）。
        </p>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => setLevel(n)}
            className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors active:scale-[0.99]"
            style={{ backgroundColor: "var(--bg-soft)", border: "1px solid var(--line)" }}
          >
            <span
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: "var(--mint)" }}
            >
              {n}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold" style={{ color: "var(--ink)" }}>
                テスト{n}：{BONUS_TEST_LABELS[n - 1]}
              </span>
              <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>
                {n === 1 ? "表示を見て、自分で言えるか確認" : n === 2 ? "練習した問題からシャッフルで出題" : "練習に出てこない新しい問題を出題"}
              </span>
            </span>
            <span className="text-xs font-semibold" style={{ color: "var(--mint)" }}>開放中</span>
          </button>
        ))}
      </Card>
    );
  }
  return (
    <BonusSession
      key={`${mod}-${level}`}
      mod={mod}
      level={level}
      speak={speak}
      cancel={cancel}
      update={update}
      onExit={() => { cancel(); setLevel(0); }}
      onNextLevel={level < 3 ? () => { cancel(); setLevel(level + 1); } : null}
    />
  );
}

// 1セッション（t1 自己採点 / t2・t3 入力式）
// 1セッション（t1 自己採点 / t2・t3 入力式）。合格でお祝い＋ポイント加算。
function BonusSession({ mod, level, speak, cancel, update, onExit, onNextLevel }) {
  const cfg = BONUS_DATA[mod];
  const [seed, setSeed] = useState(0); // 「もう一度」で t3 を再生成するための種
  const items = useMemo(() => {
    if (level === 1) return cfg.shadow.slice();
    if (level === 2) return shuffle(cfg.shadow);
    // t3: 練習に出てこない新しい問題を生成（10問）
    return genBonusItems(mod, 10);
  }, [mod, level, seed]);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ c: 0, t: 0 });
  const [result, setResult] = useState(null); // null | {ok, v1, v2}
  const [showCelebrate, setShowCelebrate] = useState(true);
  const awardedRef = useRef(false);
  const i1Ref = useRef(null);
  const i2Ref = useRef(null);

  const it = items[idx];
  const done = idx >= items.length;
  const pct = score.t ? Math.round((score.c / score.t) * 100) : 0;
  const passed = score.t > 0 && score.c / score.t >= BONUS_PASS_RATIO;
  const perfect = score.t > 0 && score.c === score.t;

  // 入力式は問題表示時に自動でお手本を鳴らす
  useEffect(() => {
    if (done || result) return;
    if (level !== 1 && it) {
      const tm = window.setTimeout(() => speak(bonusItemToTarget(it), { rate: 1.0 }), 200);
      return () => window.clearTimeout(tm);
    }
  }, [idx, done, result, level]);

  useEffect(() => () => cancel(), [cancel]);

  // 完了時に一度だけポイント加算＋学習日記録
  useEffect(() => {
    if (!done || awardedRef.current) return;
    awardedRef.current = true;
    const pts = score.c * CONFIG.POINTS_PER_CORRECT + (passed ? BONUS_CLEAR_BONUS : 0);
    if (pts > 0 && typeof update === "function") {
      update((prev) => withStudyDayMarked(withPoints(prev, pts), "num"));
    }
  }, [done]);

  const retry = () => {
    awardedRef.current = false;
    setShowCelebrate(true);
    setResult(null);
    setScore({ c: 0, t: 0 });
    setIdx(0);
    if (level === 3) setSeed((s) => s + 1); // t3は新しい問題を引き直す
  };

  if (done) {
    const earned = score.c * CONFIG.POINTS_PER_CORRECT + (passed ? BONUS_CLEAR_BONUS : 0);
    const modeLabel = level === 1 ? "言えた" : "正解";
    return (
      <div className="space-y-3">
        {passed && showCelebrate && (
          <CelebrationModal
            tier={perfect ? 4 : 2}
            title={perfect ? "全問正解！🎊" : "合格！！おめでとうございます🎊"}
            message={`テスト${level}：${modeLabel} ${score.c} / ${score.t}（${pct}%）`}
            points={earned}
            onClose={() => setShowCelebrate(false)}
            closeLabel="つづける"
          />
        )}
        <GhostButton onClick={onExit}><ArrowLeft size={14} /> テスト一覧へ</GhostButton>
        <Card className="p-6 text-center space-y-3" active activeColor={passed ? "var(--mint)" : "var(--amber)"}>
          <p className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            {passed ? "合格！！おめでとうございます 🎊" : "あと少し！もう一息 💪"}
          </p>
          <p className="font-mono text-xl" style={{ color: "var(--ink)" }}>
            {modeLabel} {score.c} / {score.t}（{pct}%）
          </p>
          {earned > 0 && (
            <p className="font-mono font-bold" style={{ color: "var(--amber)" }}>+{earned}pt</p>
          )}
          {!passed && (
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              {Math.ceil(score.t * BONUS_PASS_RATIO)}問正解で合格（8割）
            </p>
          )}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
            {passed && onNextLevel ? (
              <PrimaryButton onClick={onNextLevel}>
                テスト{level + 1}へ進む →
              </PrimaryButton>
            ) : null}
            <GhostButton onClick={retry}>
              <RotateCcw size={14} /> もう一度
            </GhostButton>
          </div>
        </Card>
      </div>
    );
  }

  const next = () => { setResult(null); setIdx((v) => v + 1); };

  // 結果表示
  if (result) {
    return (
      <div className="space-y-3">
        <GhostButton onClick={onExit}><ArrowLeft size={14} /> テスト一覧へ</GhostButton>
        <Card className="p-5 space-y-3" active activeColor={result.ok ? "var(--mint)" : "var(--red)"}>
          <p className="text-xs font-mono" style={{ color: "var(--ink-soft)" }}>{idx + 1} / {items.length}</p>
          <p className="text-2xl sm:text-3xl font-mono font-bold text-center break-words" style={{ color: "var(--ink)" }}>{it.disp}</p>
          <p className="text-center text-sm font-bold" style={{ color: result.ok ? "var(--mint)" : "var(--red)" }}>
            {result.ok ? "◯ 正解" : "× 惜しい"}
          </p>
          {!result.ok && (
            <div className="text-center text-sm rounded-xl px-3 py-2" style={{ backgroundColor: "var(--red-soft)" }}>
              <span style={{ color: "var(--red)" }}>あなた: {fmtBonusAns(it, result.v1, result.v2)}</span>
              {" ／ "}
              <span style={{ color: "var(--mint)" }}>正解: {it.disp}</span>
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            <GhostButton onClick={() => speak(bonusItemToTarget(it), { rate: 1.0 })}><Play size={14} /> もう一度</GhostButton>
            <PrimaryButton onClick={next}>次へ →</PrimaryButton>
          </div>
        </Card>
      </div>
    );
  }

  // 出題
  const submit = () => {
    const v1 = i1Ref.current ? i1Ref.current.value : "";
    const v2 = i2Ref.current ? i2Ref.current.value : "";
    const ok = checkBonus(it, v1, v2);
    setScore((s) => ({ c: s.c + (ok ? 1 : 0), t: s.t + 1 }));
    setResult({ ok, v1, v2 });
  };
  const selfMark = (ok) => { setScore((s) => ({ c: s.c + (ok ? 1 : 0), t: s.t + 1 })); next(); };

  const inputBox = () => {
    const cls = "w-16 text-center font-mono text-lg rounded-lg px-2 py-2 border";
    const st = { backgroundColor: "var(--bg-soft)", borderColor: "var(--line)", color: "var(--ink)" };
    if (it.type === "clock")
      return (
        <span className="inline-flex items-center gap-1">
          <input ref={i1Ref} inputMode="numeric" placeholder="H" className={cls} style={st} />
          <span className="font-mono text-lg">:</span>
          <input ref={i2Ref} inputMode="numeric" placeholder="MM" className={cls} style={st} />
        </span>
      );
    if (it.type === "price")
      return (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-lg">$</span>
          <input ref={i1Ref} inputMode="numeric" placeholder="D" className={cls} style={st} />
          <span className="font-mono text-lg">.</span>
          <input ref={i2Ref} inputMode="numeric" placeholder="CC" className={cls} style={st} />
        </span>
      );
    if (it.type === "whole")
      return (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-lg">$</span>
          <input ref={i1Ref} inputMode="numeric" placeholder="D" className={cls} style={st} />
        </span>
      );
    if (it.type === "phone")
      return (
        <input
          ref={i1Ref}
          inputMode="numeric"
          placeholder="10桁の番号"
          className="w-52 text-center font-mono text-lg rounded-lg px-3 py-2 border tracking-widest"
          style={st}
        />
      );
    return (
      <span className="inline-flex items-center gap-1">
        <input ref={i1Ref} inputMode="numeric" placeholder="%" className={cls} style={st} />
        <span className="font-mono text-lg">%</span>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <GhostButton onClick={onExit}><ArrowLeft size={14} /> テスト一覧へ</GhostButton>
      <Card className="p-5 space-y-4">
        <p className="text-xs font-mono" style={{ color: "var(--ink-soft)" }}>{idx + 1} / {items.length}</p>
        {level === 1 ? (
          <>
            <p className="text-2xl sm:text-3xl font-mono font-bold text-center break-words" style={{ color: "var(--ink)" }}>{it.disp}</p>
            <p className="text-center text-xs" style={{ color: "var(--ink-soft)" }}>声に出して読んでから確認</p>
            <div className="flex justify-center">
              <GhostButton onClick={() => speak(bonusItemToTarget(it), { rate: 1.0 })}><Play size={14} /> お手本</GhostButton>
            </div>
            <div className="flex items-center justify-center gap-2">
              <GhostButton onClick={() => selfMark(false)}>あやしい</GhostButton>
              <PrimaryButton onClick={() => selfMark(true)}>言えた →</PrimaryButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-4xl text-center">🔊 ？</p>
            <div className="flex justify-center">
              <GhostButton onClick={() => speak(bonusItemToTarget(it), { rate: 1.0 })}><Play size={14} /> 音声を聞く</GhostButton>
            </div>
            <div className="flex justify-center">{inputBox()}</div>
            <div className="flex justify-center">
              <PrimaryButton onClick={submit}>答え合わせ</PrimaryButton>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// 汎用ピルタブ（特典1/2/3・数字パートのカテゴリ選択に使用）
function PillTabs({ tabs, value, onChange, color = "var(--mint)" }) {
  return (
    <div className="inline-flex p-1 rounded-full gap-1 overflow-x-auto no-scrollbar max-w-full"
      style={{ backgroundColor: "var(--bg-soft)", border: "1px solid var(--line)" }}>
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors"
            style={{ backgroundColor: active ? color : "transparent", color: active ? "#fff" : "var(--ink-soft)" }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const BONUS_TOP_TABS = [
  { id: "t1", label: "特典1" },
  { id: "t2", label: "特典2" },
  { id: "t3", label: "特典3" },
];
// 数字パートのカテゴリ（ステージ1〜5 → 時間 → お金 → 電話）
const NUMPART_CATS = [
  { id: "stage", label: "🔢 数字ステージ" },
  { id: "time", label: "🕐 時間" },
  { id: "money", label: "💵 お金" },
  { id: "phone", label: "📞 電話" },
];

// 準備中プレースホルダ（特典2・特典3用）
function BonusComingSoon({ label }) {
  return (
    <Card className="p-8 text-center space-y-2">
      <Gift size={28} className="mx-auto" style={{ color: "var(--ink-soft)" }} />
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{label} は準備中です</p>
      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>内容が決まりしだい追加します。</p>
    </Card>
  );
}

function TopNav({ tab, setTab, points, streak }) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur bg-white/80 border-b"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="./logo.png"
            alt="旅する200語100フレーズ"
            className="h-10 w-auto"
            style={{ maxWidth: "min(56vw, 240px)", objectFit: "contain" }}
          />
          <span
            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "var(--amber-soft)", color: "var(--amber)" }}
            title="録音音声の実験用テスト版です。学習データは本番アプリとは別に保存されます。"
          >
            TEST
          </span>
        </div>

        <nav className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? "var(--indigo)" : "transparent",
                  color: isActive ? "#fff" : "var(--ink-soft)",
                }}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="hidden sm:flex items-center gap-2 font-mono text-sm shrink-0">
          <span
            className="flex items-center gap-1 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: "var(--amber-soft)", color: "var(--amber)" }}
          >
            <Star size={14} />
            {points}
          </span>
          <span
            className="flex items-center gap-1 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: "var(--coral-soft)", color: "var(--coral-dark)" }}
          >
            <Flame size={14} />
            {streak}
          </span>
        </div>
      </div>
    </header>
  );
}

/* =========================================================================
 * ダッシュボード画面
 * ======================================================================= */

function buildBadges(state, streak, totalShadow, wordAllCleared, sentAllCleared) {
  return [
    { id: "start", label: "はじめの一歩", earned: state.studyDays.length >= 1, icon: Sparkles },
    { id: "streak3", label: "3日連続学習", earned: streak >= 3, icon: Flame },
    { id: "streak7", label: "7日連続学習", earned: streak >= 7, icon: Flame },
    { id: "shadow30", label: "シャドーイング30回", earned: totalShadow >= 30, icon: Headphones },
    { id: "wordAll", label: "単語100マスター", earned: wordAllCleared, icon: Trophy },
    { id: "sentAll", label: "例文100マスター", earned: sentAllCleared, icon: Trophy },
  ];
}

// ステージ進捗の一覧（合格手前の達成度もここでひと目でわかる）
function StageOverview({ label, stages, color, softColor, onGo }) {
  const clearedCount = stages.filter((s) => s.cleared).length;
  // 次にやるべきステージから、ボタン文言を決める（音読が残っていれば学習、テスト待ちならテスト、全クリアなら復習）
  const nextTarget = stages.find((s) => s.unlocked && !s.cleared);
  const resumeLabel = !nextTarget
    ? "復習する"
    : nextTarget.shadowDone >= nextTarget.shadowTotal
    ? `ステージ${nextTarget.index + 1}のテストへ進む`
    : `ステージ${nextTarget.index + 1}の学習をつづける`;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Target size={16} style={{ color }} /> {label}
        </h3>
        <span className="font-mono text-xs" style={{ color: "var(--ink-soft)" }}>
          クリア {clearedCount}/{stages.length}
        </span>
      </div>
      <ProgressBar value={clearedCount} max={stages.length} color={color} height={8} />
      <div className="grid grid-cols-5 gap-2 mt-4">
        {stages.map((st) => (
          <div
            key={st.index}
            className="rounded-xl p-2 text-center"
            style={{
              backgroundColor: st.cleared ? softColor : st.unlocked ? "var(--card)" : "var(--bg-soft)",
              border: `1px solid ${st.cleared ? color : "var(--line)"}`,
              opacity: st.unlocked || st.cleared ? 1 : 0.6,
            }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: st.cleared ? color : "var(--ink)" }}>
              {st.cleared ? "✓" : st.unlocked ? st.index + 1 : <Lock size={11} className="mx-auto" />}
            </p>
            <p className="text-[10px] mt-1 font-mono" style={{ color: "var(--ink-soft)" }}>
              {st.cleared ? "合格" : st.unlocked ? `音読${st.shadowDone}/${st.shadowTotal}` : "ロック"}
            </p>
            {!st.cleared && st.unlocked && (
              <p className="text-[10px] font-mono" style={{ color: st.best > 0 ? "var(--amber)" : "var(--ink-soft)" }}>
                {st.best > 0 ? `最高${st.best}/${st.shadowTotal}` : "テスト未"}
              </p>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onGo}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold"
        style={{ color }}
      >
        {resumeLabel} <ChevronRight size={12} />
      </button>
    </Card>
  );
}

/* =========================================================================
 * 学習記録のリセット
 *  種類別 / 3種まとめて / ポイント込みで全部 の5パターン。必ず確認をはさむ。
 * ======================================================================= */

const RESET_OPTIONS = [
  { id: "word", label: "単語の記録だけリセット", desc: "単語の音読回数・テスト記録・間違いリストを消します", kinds: ["word"] },
  { id: "sent", label: "例文の記録だけリセット", desc: "例文の音読回数・テスト記録・間違いリストを消します", kinds: ["sent"] },
  { id: "num", label: "数字の記録だけリセット", desc: "数字の音読回数・テスト記録・間違いリストを消します", kinds: ["num"] },
  {
    id: "all3",
    label: "単語・例文・数字をまとめてリセット",
    desc: "3種類すべての進み具合を最初に戻します（ポイントと学習カレンダーは残ります）",
    kinds: ["word", "sent", "num", "custom"],
  },
  {
    id: "full",
    label: "ポイントも含めて全部リセット",
    desc: "累計ポイント・連続学習日数・学習カレンダーも含めて、まっさらな状態に戻します",
    full: true,
  },
];

function ResetPanel({ update }) {
  const [pending, setPending] = useState(null); // 確認待ちのオプション
  const [doneMsg, setDoneMsg] = useState(null);

  const run = (opt) => {
    update((prev) => (opt.full ? withFullReset(prev) : withKindReset(prev, opt.kinds)));
    setPending(null);
    setDoneMsg(`${opt.label.replace("リセット", "")}をリセットしました。`);
    window.setTimeout(() => setDoneMsg(null), 5000);
  };

  return (
    <details className="rounded-2xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)" }}>
      <summary className="cursor-pointer px-5 py-3 font-medium select-none text-sm flex items-center gap-2" style={{ color: "var(--ink-soft)" }}>
        <RotateCcw size={15} /> 学習記録をリセットする
      </summary>
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          もう一度はじめから学習したいときや、ご家族に最初から使ってもらいたいときに使えます。消した記録は元に戻せません。
        </p>

        {doneMsg && <NoticeBanner text={doneMsg} />}

        {RESET_OPTIONS.map((opt) => (
          <div
            key={opt.id}
            className="rounded-xl p-3 flex flex-wrap items-center gap-3"
            style={{
              backgroundColor: opt.full ? "var(--red-soft)" : "var(--bg-soft)",
              border: `1px solid ${opt.full ? "var(--red)" : "var(--line)"}`,
            }}
          >
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold" style={{ color: opt.full ? "var(--red)" : "var(--ink)" }}>
                {opt.label}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-soft)" }}>
                {opt.desc}
              </p>
            </div>
            <div className="ml-auto">
              <GhostButton onClick={() => setPending(opt)}>
                <RotateCcw size={13} /> リセット
              </GhostButton>
            </div>
          </div>
        ))}
      </div>

      {/* 確認ダイアログ */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(22,32,43,0.6)", backdropFilter: "blur(2px)" }}
        >
          <div
            className="rounded-3xl p-6 max-w-sm w-full text-center animate-pop"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)" }}
          >
            <span
              className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: "var(--red-soft)", color: "var(--red)" }}
            >
              <AlertTriangle size={26} />
            </span>
            <h2 className="font-display text-lg font-bold">本当にリセットしますか？</h2>
            <p className="text-sm mt-2" style={{ color: "var(--ink-soft)" }}>
              {pending.label}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              {pending.desc}
            </p>
            <p className="text-xs mt-3 font-semibold" style={{ color: "var(--red)" }}>
              一度消すと元に戻せません。
            </p>
            <div className="flex flex-col gap-2 mt-5">
              <DangerButton onClick={() => run(pending)}>
                <RotateCcw size={15} /> リセットする
              </DangerButton>
              <GhostButton onClick={() => setPending(null)} className="justify-center">
                やめる
              </GhostButton>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}

// ホーム: 総合ポイントのマイルストーン（旅テーマの達成度）。バッジの代わりに達成レベルを可視化。
function PointMilestones({ points }) {
  const { idx, cur, next, ratio } = milestoneProgress(points);
  return (
    <Card className="p-5">
      <h2 className="font-display font-semibold flex items-center gap-2 mb-3">
        <Award size={18} /> 旅の達成度
      </h2>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
          style={{ backgroundColor: "var(--amber-soft)" }}>{cur.emoji}</div>
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{cur.label}</p>
          <p className="font-mono text-xs" style={{ color: "var(--ink-soft)" }}>
            {points.toLocaleString()}pt
            {next ? ` ・ 次まであと ${(next.pt - points).toLocaleString()}pt` : " ・ 最高ランク到達！"}
          </p>
        </div>
      </div>
      {next && (
        <div className="h-2 rounded-full overflow-hidden mb-4" style={{ backgroundColor: "var(--bg-soft)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: "var(--amber)" }} />
        </div>
      )}
      <div className="flex items-start justify-between gap-1">
        {POINT_MILESTONES.map((m, i) => {
          const reached = points >= m.pt;
          return (
            <div key={m.pt} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${m.label}・${m.pt}pt`}>
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${reached ? "" : "opacity-30"}`}
                style={{
                  backgroundColor: reached ? "var(--amber-soft)" : "var(--bg-soft)",
                  border: `1px solid ${i === idx ? "var(--amber)" : "var(--line)"}`,
                }}
              >
                {m.emoji}
              </div>
              <span className="text-[9px] font-mono leading-tight text-center" style={{ color: reached ? "var(--ink)" : "var(--ink-soft)" }}>
                {m.pt}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Dashboard({ state, setTab, goTo, wordStages, sentStages, numStages, onResume, update }) {
  const streak = computeStreak(state.studyDays);
  const totalShadow = sumValues(state.wordShadow) + sumValues(state.sentShadow) + sumValues(state.numShadow || {});
  const days = useMemo(() => lastNDays(28), []);
  const studySet = useMemo(() => new Set(state.studyDays), [state.studyDays]);
  const today = todayKey();
  const wordAllCleared = wordStages.every((s) => s.cleared);
  const sentAllCleared = sentStages.every((s) => s.cleared);
  const badges = useMemo(
    () => buildBadges(state, streak, totalShadow, wordAllCleared, sentAllCleared),
    [state, streak, totalShadow, wordAllCleared, sentAllCleared]
  );
  const mistakeCount =
    Object.keys(state.mistakes.word || {}).length +
    Object.keys(state.mistakes.sent || {}).length +
    Object.keys(state.mistakes.custom || {}).length +
    Object.keys(state.mistakes.num || {}).length;

  return (
    <div className="space-y-6 animate-pop">
      <section>
        <h1 className="font-display text-2xl sm:text-3xl font-bold">おかえりなさい 👋</h1>
        <p className="mt-1" style={{ color: "var(--ink-soft)" }}>
          聞き取れる耳をつくる、最初の100。今日も少しずつ進めましょう。
        </p>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Star} label="累計ポイント" value={state.totalPoints} color="var(--amber)" bg="var(--amber-soft)" />
        <StatCard icon={Flame} label="連続学習日数" value={`${streak}日`} color="var(--coral)" bg="var(--coral-soft)" />
        <StatCard icon={Headphones} label="シャドーイング回数" value={totalShadow} color="var(--indigo)" bg="var(--indigo-soft)" />
        <StatCard
          icon={RotateCcw}
          label="復習まちの問題"
          value={`${mistakeCount}問`}
          color="var(--mint)"
          bg="var(--mint-soft)"
        />
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StageOverview
          label="100単語への道"
          stages={wordStages}
          color="var(--coral)"
          softColor="var(--coral-soft)"
          onGo={() => onResume("word", wordStages)}
        />
        <StageOverview
          label="100例文への道"
          stages={sentStages}
          color="var(--indigo)"
          softColor="var(--indigo-soft)"
          onGo={() => onResume("sent", sentStages)}
        />
        <StageOverview
          label="数字マスターへの道"
          stages={numStages}
          color="var(--mint)"
          softColor="var(--mint-soft)"
          onGo={() => onResume("num", numStages)}
        />
      </section>

      <section className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display font-semibold flex items-center gap-2">
              <CalendarIcon size={18} /> 学習カレンダー
            </h2>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--ink-soft)" }}>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--coral)" }} /> 単語
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--indigo)" }} /> 例文
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--mint)" }} /> 数字
              </span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] mb-1" style={{ color: "var(--ink-soft)" }}>
            {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const studied = studySet.has(d.key);
              const isToday = d.key === today;
              const log = state.studyLog[d.key] || {};
              const md = `${d.date.getMonth() + 1}/${d.date.getDate()}`;
              const dotColors = [];
              if (log.word) dotColors.push("var(--coral)");
              if (log.sent) dotColors.push("var(--indigo)");
              if (log.num) dotColors.push("var(--mint)");
              return (
                <div
                  key={d.key}
                  title={d.key}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 ${
                    isToday ? "ring-2 ring-[var(--indigo)] ring-offset-1" : ""
                  }`}
                  style={{
                    backgroundColor: studied ? "var(--mint-soft)" : "var(--bg-soft)",
                    color: studied ? "var(--ink)" : "var(--ink-soft)",
                  }}
                >
                  <span className="text-[10px] font-mono leading-none">{md}</span>
                  <span className="flex items-center gap-[2px] h-1.5">
                    {dotColors.length > 0 ? (
                      dotColors.map((c, i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                      ))
                    ) : studied ? (
                      // 種類記録のない学習日（マイリスト等）は小さなチェック相当のドット
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--mint)" }} />
                    ) : (
                      <span className="w-1.5 h-1.5" />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <PointMilestones points={state.totalPoints} />
      </section>

      <ResetPanel update={update} />
    </div>
  );
}

/* =========================================================================
 * 単語学習 / 例文学習 画面（ステージ制対応）
 * ======================================================================= */

const REPEAT_OPTIONS = [1, 3, 5, "infinite"];

// ロック中ステージの表示（解放条件と救済までの残り日数を明示）
function LockedStageCard({ stage, unit, unlockMode }) {
  const prev = stage.prevStage;
  const CondIcon = ({ ok }) =>
    ok ? (
      <CheckCircle2 size={13} className="shrink-0 mt-0.5" style={{ color: "var(--mint)" }} />
    ) : (
      <span className="w-[13px] text-center shrink-0">・</span>
    );
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
        >
          <Lock size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-display font-semibold">
            ステージ{stage.index + 1}{" "}
            <span className="font-mono text-xs font-normal" style={{ color: "var(--ink-soft)" }}>
              ({stage.items.length}
              {unit})
            </span>{" "}
            はロック中
          </p>
          <div className="text-xs mt-2 space-y-1" style={{ color: "var(--ink-soft)" }}>
            <p className="font-medium">解放条件{unlockMode === "shadow" ? "（どちらか1つでOK）" : ""}:</p>
            <p className="flex items-start gap-1.5">
              <CondIcon ok={prev && prev.cleared && prev.shadowDone >= prev.shadowTotal} />
              <span>
                ステージ{stage.index}の音読 各{CONFIG.SHADOW_REQUIRED}回以上（
                <span className="font-mono">
                  {prev ? prev.shadowDone : 0}/{prev ? prev.shadowTotal : CONFIG.STAGE_SIZE}
                </span>
                ）＋ テストに全問正解
                {prev && !prev.cleared && prev.best > 0 && (
                  <span className="font-mono" style={{ color: "var(--amber)" }}>
                    （最高 {prev.best}/{prev.shadowTotal}）
                  </span>
                )}
              </span>
            </p>
            {unlockMode === "shadow" && (
              <p className="flex items-start gap-1.5">
                <CondIcon ok={prev && prev.shadowTotal > 0 && prev.shadowDeep >= prev.shadowTotal} />
                <span>
                  【音読だけで解放】ステージ{stage.index}の全項目を各{CONFIG.QUICK_UNLOCK_SHADOW_PER_ITEM}回以上音読（いま{" "}
                  <span className="font-mono">
                    {prev ? prev.shadowDeep : 0}/{prev ? prev.shadowTotal : CONFIG.STAGE_SIZE}項目
                  </span>
                  ）— 「全部シャドーイングした！」ボタンで一気に貯められます
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LearnScreen({
  kind,
  stages,
  state,
  update,
  speak,
  cancel,
  makeUtterance,
  supported,
  voices,
  englishVoices,
  voiceURI,
  setVoiceURI,
  hasEnglishVoice,
  onGoTest,
  stageLabels = null,
  focusStageIndex = null,
  onFocusApplied = null,
  renderStageExtra = null,
  devMode = false,
}) {
  const isWord = kind === "word";
  const isCustom = kind === "custom";
  const isNum = kind === "num";
  const progressMap = state[SHADOW_KEYS[kind]] || {};
  const unlockMode = (state.settings && state.settings.unlockMode) || "test";
  const totalCount = stages.reduce((n, s) => n + s.items.length, 0);
  const learnPrefs = (state.settings && state.settings.learnPrefs) || { repeat: 3, speed: 1.0 };

  // リピート回数・速度は保存済み設定から初期化し、変更時は保存する（次回も維持）
  const [repeatSetting, setRepeatSettingRaw] = useState(learnPrefs.repeat);
  const [speedSetting, setSpeedSettingRaw] = useState(learnPrefs.speed);
  const setRepeatSetting = (v) => {
    setRepeatSettingRaw(v);
    update((prev) => withLearnPrefs(prev, { repeat: v }));
  };
  const setSpeedSetting = (v) => {
    setSpeedSettingRaw(v);
    update((prev) => withLearnPrefs(prev, { speed: v }));
  };

  // アコーディオン: クリア済みステージは閉じて表示。次にやるべきステージ（未クリアで解放済みの最初）は開く。
  // focusStageIndex が指定されていればそのステージを開く（ホームの「つづきから」用）。
  const firstUnclearedIndex = stages.find((s) => s.unlocked && !s.cleared)?.index ?? null;
  const initialOpen = focusStageIndex != null ? focusStageIndex : firstUnclearedIndex;
  const [openStages, setOpenStages] = useState(() => (initialOpen != null ? { [initialOpen]: true } : {}));
  const toggleStage = (idx) => setOpenStages((o) => ({ ...o, [idx]: !o[idx] }));

  // 次にやるステージが変わったら（＝ステージをクリアしたら）そのステージを自動で開く
  useEffect(() => {
    if (firstUnclearedIndex == null) return;
    setOpenStages((o) => (o[firstUnclearedIndex] ? o : { ...o, [firstUnclearedIndex]: true }));
  }, [firstUnclearedIndex]);

  // ホームの「つづきから」や「次のステージの学習に進む」で指定されたステージを開く。
  // 他のステージは閉じて、そのステージだけが見えるようにする（どこをやるか迷わないため）。
  useEffect(() => {
    if (focusStageIndex == null) return;
    setOpenStages({ [focusStageIndex]: true });
    // 対象ステージの位置までスクロール
    window.setTimeout(() => {
      const el = document.getElementById(`${kind}-stage-${focusStageIndex}`);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    // 一度反映したら指定を解除する（以降の手動での開閉を邪魔しないため）
    if (onFocusApplied) onFocusApplied();
  }, [focusStageIndex, kind, onFocusApplied]);
  const [activeId, setActiveId] = useState(null);
  const [currentRep, setCurrentRep] = useState(0);
  const [playingSetIndex, setPlayingSetIndex] = useState(null);
  const [bumpedId, setBumpedId] = useState(null);
  const [bulkBumpStage, setBulkBumpStage] = useState(null);

  const playTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
    };
  }, [cancel]);

  const stopPlayback = () => {
    playTokenRef.current += 1;
    cancel();
    setActiveId(null);
    setPlayingSetIndex(null);
    setCurrentRep(0);
  };

  // 1項目を repeat 回連続再生（録音音声・TTSどちらでも onend で次をつなぐチェーン方式）
  // 数字(kind==="num")の項目は value からパーツ列を付けて渡す（付けないと parts が無く TTS に落ちる）。
  const speakTargetFor = (item) =>
    isNum && item && item.value != null ? { ...item, ...makeNumberSpeakTarget(item.value) } : item;
  const playOne = (item) => {
    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();
    setPlayingSetIndex(null);
    setActiveId(item.id);
    setCurrentRep(0);

    const max = repeatSetting === "infinite" ? Infinity : repeatSetting;
    let rep = 0;
    const step = () => {
      if (playTokenRef.current !== token) return;
      if (rep >= max) {
        setActiveId(null);
        setCurrentRep(0);
        return;
      }
      rep += 1;
      setCurrentRep(rep);
      speak(speakTargetFor(item), {
        rate: speedSetting,
        onend: () => {
          if (playTokenRef.current === token) window.setTimeout(step, CONFIG.PLAY_GAP_MS / speedSetting); // 項目間ポーズ（token検査はstep内でも行うので停止後の発火は無害）
        },
      });
    };
    step();
  };

  // ステージ全体を順番に連続再生（録音音声とTTSが混在してもOKなチェーン方式）
  const playSet = (stage) => {
    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();
    setPlayingSetIndex(stage.index);
    const perItemMax = repeatSetting === "infinite" ? 2 : repeatSetting;

    // 再生順のキューを作る: [項目1×N回, 項目2×N回, ...]
    const seq = [];
    stage.items.forEach((item) => {
      for (let r = 1; r <= perItemMax; r++) seq.push({ item, rep: r });
    });

    let i = 0;
    const step = () => {
      if (playTokenRef.current !== token) return;
      if (i >= seq.length) {
        setPlayingSetIndex(null);
        setActiveId(null);
        setCurrentRep(0);
        return;
      }
      const { item, rep } = seq[i++];
      setActiveId(item.id);
      setCurrentRep(rep);
      speak(speakTargetFor(item), {
        rate: speedSetting,
        onend: () => {
          if (playTokenRef.current === token) window.setTimeout(step, CONFIG.PLAY_GAP_MS / speedSetting); // 項目間ポーズ
        },
      });
    };
    step();
  };

  const markShadow = (item) => {
    update((prev) => withStudyDayMarked(withShadow(prev, kind, item.id), kind));
    setBumpedId(item.id);
    window.setTimeout(() => setBumpedId(null), 650);
  };

  // セット再生と一緒にシャドーイングした時用: ステージ全項目にまとめて+1
  const markShadowBulk = (stage) => {
    update((prev) =>
      withStudyDayMarked(
        withShadowBulk(
          prev,
          kind,
          stage.items.map((it) => it.id)
        ),
        kind
      )
    );
    setBulkBumpStage(stage.index);
    window.setTimeout(() => setBulkBumpStage(null), 800);
  };

  const title = isWord
    ? "⭐ これだけマスター100単語"
    : isCustom
    ? "⭐ マイリスト練習"
    : isNum
    ? "⭐ 数字マスター"
    : "⭐ 日常・旅行会話100例文";
  const sub = isWord
    ? "英単語をネイティブのスピードで聞き取れるようにしよう。"
    : isCustom
    ? "自分で登録した単語・例文をシャドーイングで身につけよう。"
    : isNum
    ? "数字を耳で覚えよう。カードの下段が英語の読み方。"
    : "会話でよく使う例文をシャドーイングで身につけよう。";
  const unit = isWord ? "語" : isCustom || isNum ? "個" : "文";

  return (
    <div className="space-y-5 animate-pop">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold">{title}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
          {sub}
          {isCustom
            ? `（登録 ${totalCount}${unit}）`
            : isNum
            ? `（収録 ${totalCount}${unit}・桁ごとの${stages.length}ステージ制）`
            : `（収録 ${totalCount}${unit}・${CONFIG.STAGE_SIZE}${unit}ずつの${stages.length}ステージ制）`}
        </p>
      </div>

      {!isCustom && (
        <Card className="p-4 space-y-2">
          <p className="text-sm font-semibold font-display flex items-center gap-2">
            <Lock size={14} /> ステージの進み方
          </p>
          <div className="flex gap-1 flex-wrap">
            <Chip active={unlockMode === "test"} onClick={() => update((p) => withUnlockMode(p, "test"))}>
              テスト合格で解放（標準）
            </Chip>
            <Chip active={unlockMode === "shadow"} onClick={() => update((p) => withUnlockMode(p, "shadow"))}>
              音読だけで解放（どんどん進む）
            </Chip>
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
            「音読だけで解放」では、前ステージの全項目をそれぞれ{CONFIG.QUICK_UNLOCK_SHADOW_PER_ITEM}
            回以上音読すると、テスト未合格でも次のステージが解放されます（テストに合格していれば各
            {CONFIG.SHADOW_REQUIRED}回でOK）。覚えきれなくてもまず100{unit}をひと回しして、合格はあとから狙う進め方です。設定は単語・例文で共通です。
          </p>
        </Card>
      )}

      {!supported && <NoticeBanner text="この端末は音声合成に対応していないため、タイミングを再現したダミー再生で進行します。" />}
      {supported && (
        <VoiceSettings
          supported={supported}
          voices={voices}
          englishVoices={englishVoices}
          voiceURI={voiceURI}
          setVoiceURI={setVoiceURI}
          hasEnglishVoice={hasEnglishVoice}
        />
      )}
      {supported && <VoiceDiagnostics supported={supported} voices={voices} voiceURI={voiceURI} />}

      {stages.map((stage) => {
        if (!stage.unlocked) {
          return <LockedStageCard key={stage.index} stage={stage} unit={unit} unlockMode={unlockMode} />;
        }
        const isPlayingThisSet = playingSetIndex === stage.index;
        // 次にやるべきステージ（解放済み・未クリアの最初）を強調する
        const isNextStage = stage.index === firstUnclearedIndex;
        return (
          <div key={stage.index} id={`${kind}-stage-${stage.index}`} className="space-y-3">
            <Card className="p-4 space-y-3" active={isNextStage} activeColor="var(--indigo)">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  onClick={() => toggleStage(stage.index)}
                  className="flex items-center gap-1.5 text-sm font-semibold font-display shrink-0"
                >
                  <ChevronRight
                    size={16}
                    style={{
                      transform: openStages[stage.index] ? "rotate(90deg)" : "none",
                      transition: "transform 0.15s",
                      color: "var(--ink-soft)",
                    }}
                  />
                  ステージ{stage.index + 1}
                  {stageLabels && stageLabels[stage.index] ? `「${stageLabels[stage.index]}」` : ""}{" "}
                  <span className="font-mono font-normal text-xs" style={{ color: "var(--ink-soft)" }}>
                    ({stage.items.length}
                    {unit})
                  </span>
                  {stage.cleared && (
                    <span
                      className="flex items-center gap-0.5 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
                    >
                      <CheckCircle2 size={11} /> クリア
                    </span>
                  )}
                  {isNextStage && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--indigo)", color: "#fff" }}
                    >
                      次はここ
                    </span>
                  )}
                </button>
                <span
                  className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: stage.shadowDone >= stage.shadowTotal ? "var(--mint-soft)" : "var(--bg-soft)",
                    color: stage.shadowDone >= stage.shadowTotal ? "var(--mint)" : "var(--ink-soft)",
                  }}
                >
                  <Mic size={11} /> 音読 {stage.shadowDone}/{stage.shadowTotal}
                </span>
                <span
                  className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: stage.cleared ? "var(--mint-soft)" : "var(--bg-soft)",
                    color: stage.cleared ? "var(--mint)" : stage.best > 0 ? "var(--amber)" : "var(--ink-soft)",
                  }}
                >
                  <Trophy size={11} />
                  {stage.cleared ? "テスト合格済み" : stage.best > 0 ? `テスト最高 ${stage.best}/${stage.shadowTotal}` : "テスト未挑戦"}
                </span>
                {unlockMode === "shadow" && !stage.cleared && (
                  <span
                    className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        stage.shadowDeep >= stage.shadowTotal ? "var(--mint-soft)" : "var(--bg-soft)",
                      color: stage.shadowDeep >= stage.shadowTotal ? "var(--mint)" : "var(--ink-soft)",
                    }}
                  >
                    {CONFIG.QUICK_UNLOCK_SHADOW_PER_ITEM}回音読済み {stage.shadowDeep}/{stage.shadowTotal}
                  </span>
                )}
                {openStages[stage.index] && (
                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    {bulkBumpStage === stage.index && (
                      <span className="text-[11px] font-mono font-bold animate-floatup" style={{ color: "var(--mint)" }}>
                        +{stage.items.length}
                      </span>
                    )}
                    <ShadowButton onClick={() => markShadowBulk(stage)}>
                      <Check size={14} /> 全部シャドーイングした！ +{stage.items.length}
                    </ShadowButton>
                    {!isPlayingThisSet ? (
                      <PrimaryButton onClick={() => playSet(stage)}>
                        <Play size={16} /> セット再生
                      </PrimaryButton>
                    ) : (
                      <DangerButton onClick={stopPlayback}>
                        <Square size={16} /> 停止
                      </DangerButton>
                    )}
                  </div>
                )}
              </div>
              {openStages[stage.index] && (
                <div className="flex flex-wrap items-center gap-4">
                  <ControlGroup label="リピート" icon={Repeat}>
                    {REPEAT_OPTIONS.map((v) => (
                      <Chip key={String(v)} active={repeatSetting === v} onClick={() => setRepeatSetting(v)}>
                        {v === "infinite" ? "∞" : `${v}回`}
                      </Chip>
                    ))}
                  </ControlGroup>
                  <ControlGroup label="速度" icon={Gauge}>
                    {CONFIG.LEARN_SPEEDS.map((v) => (
                      <Chip key={v} active={speedSetting === v} onClick={() => setSpeedSetting(v)}>
                        {v.toFixed(1)}x
                      </Chip>
                    ))}
                  </ControlGroup>
                  <div className="ml-auto">
                    {stage.shadowDone >= stage.shadowTotal || devMode ? (
                      <IndigoButton onClick={() => onGoTest && onGoTest(stage.index)}>
                        <ListChecks size={15} /> このステージのテストへ
                      </IndigoButton>
                    ) : (
                      // 音読（各3回）が終わるまではテストに進めない
                      <span
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
                      >
                        <Lock size={13} /> 音読あと{stage.shadowTotal - stage.shadowDone}
                        {unit}でテスト解放
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Card>

            {openStages[stage.index] && (
              <div className="grid sm:grid-cols-2 gap-3">
              {stage.items.map((item) => {
                const count = progressMap[item.id] || 0;
                const active = activeId === item.id;
                const shadowOk = count >= CONFIG.SHADOW_REQUIRED;
                return (
                  <Card key={item.id} active={active} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display font-semibold text-base flex items-center gap-1.5">
                          {item.en}
                          {item.audio && (
                            <span
                              className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
                              title="録音音声で再生されます（どの端末でも同じ声・同じ速さ）"
                            >
                              録音
                            </span>
                          )}
                        </p>
                        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
                          {item.ja}
                        </p>
                      </div>
                      <button
                        aria-label={active ? "停止" : "再生"}
                        onClick={() => (active ? stopPlayback() : playOne(item))}
                        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                        style={{ backgroundColor: active ? "var(--coral)" : "var(--coral-soft)" }}
                      >
                        {active ? (
                          <EqualizerBars active size={16} color="#ffffff" />
                        ) : (
                          <Play size={16} color="var(--coral)" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono" style={{ color: "var(--ink-soft)" }}>
                        {active
                          ? `再生中 ${currentRep}/${repeatSetting === "infinite" ? "∞" : repeatSetting}`
                          : "\u00A0"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {bumpedId === item.id && (
                          <span className="text-[10px] font-mono font-bold animate-floatup" style={{ color: "var(--mint)" }}>
                            +1
                          </span>
                        )}
                        {count >= CONFIG.QUICK_UNLOCK_SHADOW_PER_ITEM && (
                          <Star size={14} style={{ color: "var(--gold)" }} />
                        )}
                        {shadowOk && <CheckCircle2 size={14} style={{ color: "var(--mint)" }} />}
                        <ShadowButton onClick={() => markShadow(item)}>
                          <Check size={14} /> シャドーイングした！ <span className="font-mono">{count}</span>
                        </ShadowButton>
                      </div>
                    </div>
                  </Card>
                );
              })}
              </div>
            )}

            {openStages[stage.index] && renderStageExtra && renderStageExtra(stage.index)}

            {openStages[stage.index] && !stage.cleared && stage.shadowDone >= stage.shadowTotal && (
              <Card className="p-4 flex flex-wrap items-center gap-3">
                <p className="text-sm flex-1 min-w-[200px]" style={{ color: "var(--ink-soft)" }}>
                  音読はバッチリ！あとはステージ{stage.index + 1}のテストに全問正解すれば
                  {stage.index + 1 < stages.length ? "次のステージが解放されます。" : "全ステージ制覇です！"}
                </p>
                <IndigoButton onClick={onGoTest}>
                  <ListChecks size={16} /> テストへ進む
                </IndigoButton>
              </Card>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================================
 * テストのハブ画面（モード選択・難易度設定・達成度一覧・間違い問題の復習）
 * ======================================================================= */

const STAGE_CLEAR_MESSAGES = [
  { title: "ステージ1 クリア！", msg: "最初の20個を制覇！いいスタート！" },
  { title: "ステージ2 クリア！", msg: "40個目まで到達！耳が育ってきています！" },
  { title: "ステージ3 クリア！", msg: "折り返し突破！60個マスター！" },
  { title: "ステージ4 クリア！", msg: "80個クリア！ゴールはもう目の前！" },
  { title: "ステージ5 クリア！\n全ステージ制覇！", msg: "100個すべてのステージテストに合格しました！" },
];

function TestHub({
  kind,
  items,
  stages,
  state,
  update,
  speak,
  cancel,
  supported,
  voices,
  englishVoices,
  voiceURI,
  setVoiceURI,
  hasEnglishVoice,
  onExit,
  onHome,
  onGoStageLearn,
  devMode = false,
}) {
  const isWord = kind === "word";
  const isCustom = kind === "custom";
  const unit = isWord ? "語" : isCustom ? "個" : "文";
  const kindLabel = isWord ? "単語" : isCustom ? "マイリスト" : "例文";

  // 難易度設定（この設定ごとに合格記録が保存される）。保存済み設定から復元し、変更時は保存する。
  const testPrefs = (state.settings && state.settings.testPrefs) || {};
  // showText初期値: 保存があればそれを、なければ種類ごとの既定（単語=表示あり / 例文=なし）
  const [showText, setShowTextRaw] = useState(testPrefs.showText == null ? isWord : testPrefs.showText);
  const [speed, setSpeedRaw] = useState(testPrefs.speed || 1.0);
  const [answerSec, setAnswerSecRaw] = useState(testPrefs.answerSec || CONFIG.DEFAULT_ANSWER_TIME);
  const setShowText = (v) => {
    setShowTextRaw(v);
    update((prev) => withTestPrefs(prev, { showText: v }));
  };
  const setSpeed = (v) => {
    setSpeedRaw(v);
    update((prev) => withTestPrefs(prev, { speed: v }));
  };
  const setAnswerSec = (v) => {
    setAnswerSecRaw(v);
    update((prev) => withTestPrefs(prev, { answerSec: v }));
  };
  const [mode, setMode] = useState(null); // {type:"stage",stageIndex} | {type:"shuffle"} | {type:"full"} | {type:"mistake"} | {type:"practice"}

  const mistakesMap = state.mistakes[kind] || {};
  const mistakeItems = useMemo(() => items.filter((it) => mistakesMap[it.id]), [items, mistakesMap]);
  const unlockedItems = useMemo(() => stages.filter((s) => s.unlocked).flatMap((s) => s.items), [stages]);
  const kindTests = state.tests[kind] || {};

  const voiceProps = { supported, voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice };

  if (mode && mode.type === "practice") {
    return (
      <MistakePractice
        kind={kind}
        mistakeItems={mistakeItems}
        mistakesMap={mistakesMap}
        update={update}
        speak={speak}
        cancel={cancel}
        onBack={() => setMode(null)}
        onGoTest={() => setMode({ type: "mistake" })}
      />
    );
  }

  if (mode) {
    const buildQuestions = () => {
      if (mode.type === "stage") return shuffle(stages[mode.stageIndex].items);
      if (mode.type === "shuffle") return shuffle(unlockedItems).slice(0, CONFIG.SHUFFLE_TEST_SIZE);
      if (mode.type === "full") return shuffle(items);
      return shuffle(items.filter((it) => (state.mistakes[kind] || {})[it.id]));
    };
    return (
      <TestRunner
        // モードが変わったら必ず作り直す（前のテストの終了状態が残るのを防ぐ）
        key={`${mode.type}-${mode.stageIndex ?? ""}`}
        kind={kind}
        mode={mode}
        items={items}
        stages={stages}
        buildQuestions={buildQuestions}
        showText={showText}
        speed={speed}
        answerSec={answerSec}
        update={update}
        speak={speak}
        cancel={cancel}
        supported={supported}
        onBack={() => setMode(null)}
        onHome={onHome}
        onNextStageLearn={
          mode.type === "stage" && stages[mode.stageIndex + 1] && onGoStageLearn
            ? () => onGoStageLearn(mode.stageIndex + 1)
            : null
        }
      />
    );
  }

  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">{kindLabel}リスニングテスト</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            全問正解で合格。難易度（英文表示×速度×回答時間）ごとの合格記録も残ります。
          </p>
        </div>
        <GhostButton onClick={onExit} className="shrink-0">
          <ArrowLeft size={14} /> ホームへ
        </GhostButton>
      </div>

      {!supported && <NoticeBanner text="この端末は音声合成に対応していないため、タイミングを再現したダミー再生で進行します。" />}
      {supported && <VoiceSettings {...voiceProps} />}
      {supported && <VoiceDiagnostics supported={supported} voices={voices} voiceURI={voiceURI} />}

      {/* 難易度設定 */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-semibold font-display flex items-center gap-2">
          <Gauge size={16} /> 難易度設定
          <span
            className="text-[11px] font-mono font-normal px-2 py-0.5 rounded-full"
            style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
          >
            いま: {diffLabel(showText, speed, answerSec)}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <ControlGroup label="英文表示" icon={showText ? Eye : EyeOff}>
            <Chip active={showText} onClick={() => setShowText(true)}>
              表示あり
            </Chip>
            <Chip active={!showText} onClick={() => setShowText(false)}>
              表示なし
            </Chip>
          </ControlGroup>
          <ControlGroup label="速度" icon={Gauge}>
            {CONFIG.TEST_SPEEDS.map((v) => (
              <Chip key={v} active={speed === v} onClick={() => setSpeed(v)}>
                {v.toFixed(1)}x
              </Chip>
            ))}
          </ControlGroup>
          <ControlGroup label="回答時間" icon={Target}>
            {CONFIG.ANSWER_TIMES.map((t) => (
              <Chip key={t} active={answerSec === t} onClick={() => setAnswerSec(t)}>
                {t}秒
              </Chip>
            ))}
          </ControlGroup>
        </div>
        <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
          ステージ解放の条件は「どれかの難易度で全問正解」。最終目標は
          <span className="font-semibold">「英文なし・2.0x・回答2秒」</span>
          のフルスピード耳！達成度マトリクスには難易度ごとの最短回答時間（✓2sなど）が刻まれます。
        </p>
      </Card>

      {/* ステージテスト */}
      <section className="space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-2">
          <Target size={16} /> ステージテスト（各20問）
        </h2>
        {stages.map((st) => {
          const rangeLabel = `${st.index * CONFIG.STAGE_SIZE + 1}〜${st.index * CONFIG.STAGE_SIZE + st.items.length}`;
          const shadowOk = st.shadowDone >= st.shadowTotal;
          // 次に受けるべきテスト＝解放済み・音読完了・未合格の最初のステージ
          const isNext =
            st.unlocked &&
            shadowOk &&
            !st.cleared &&
            !stages.some((o) => o.index < st.index && o.unlocked && o.shadowDone >= o.shadowTotal && !o.cleared);
          return (
            <Card key={st.index} className="p-4" active={isNext} activeColor="var(--indigo)">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-[140px]">
                  <p className="font-display font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                    ステージ{st.index + 1}
                    <span className="font-mono text-[11px] font-normal" style={{ color: "var(--ink-soft)" }}>
                      ({rangeLabel}
                      {unit}目)
                    </span>
                    {st.cleared && (
                      <span
                        className="flex items-center gap-0.5 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
                      >
                        <CheckCircle2 size={11} /> 合格済み
                      </span>
                    )}
                    {isNext && (
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: "var(--indigo)", color: "#fff" }}
                      >
                        次はここ
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex-1 min-w-[160px] space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "var(--ink-soft)" }}>
                    <Mic size={11} className="shrink-0" />
                    <ProgressBar value={st.shadowDone} max={st.shadowTotal} color="var(--indigo)" />
                    <span className="shrink-0">
                      {st.shadowDone}/{st.shadowTotal}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "var(--ink-soft)" }}>
                    <Trophy size={11} className="shrink-0" />
                    <ProgressBar value={st.best} max={st.shadowTotal} color={st.cleared ? "var(--mint)" : "var(--amber)"} />
                    <span className="shrink-0">{st.best > 0 ? `最高 ${st.best}/${st.shadowTotal}` : "未挑戦"}</span>
                  </div>
                </div>
                <div className="ml-auto">
                  {!st.unlocked ? (
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
                    >
                      <Lock size={13} /> 前ステージをクリアで解放
                    </span>
                  ) : st.shadowDone < st.shadowTotal && !devMode ? (
                    // 音読（各3回）が終わるまでテストは開けない。先に学習へ誘導する
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
                      title={`各${CONFIG.SHADOW_REQUIRED}回の音読を終えるとテストが受けられます`}
                    >
                      <Lock size={13} /> 音読を完了すると解放（{st.shadowDone}/{st.shadowTotal}）
                    </span>
                  ) : (
                    <IndigoButton onClick={() => setMode({ type: "stage", stageIndex: st.index })}>
                      <Play size={14} /> {st.cleared ? "もう一度" : "テスト開始"}
                    </IndigoButton>
                  )}
                </div>
              </div>
              {Object.keys(st.records).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-medium select-none" style={{ color: "var(--indigo)" }}>
                    難易度別の達成度を見る
                  </summary>
                  <div className="mt-2">
                    <DifficultyMatrix records={st.records} />
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </section>

      {/* シャッフル / 全問チャレンジ */}
      <section className="grid sm:grid-cols-2 gap-3">
        <Card className="p-5 flex flex-col gap-3">
          <div>
            <h3 className="font-display font-semibold flex items-center gap-2">
              <ShuffleIcon size={16} style={{ color: "var(--coral)" }} /> 実力シャッフルテスト
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              いままで解放された{unlockedItems.length}
              {unit}の中からランダムに{Math.min(CONFIG.SHUFFLE_TEST_SIZE, unlockedItems.length)}問出題。
            </p>
          </div>
          {Object.keys(kindTests["shuffle"] || {}).length > 0 && (
            <DifficultyMatrix records={kindTests["shuffle"]} />
          )}
          <PrimaryButton onClick={() => setMode({ type: "shuffle" })} className="w-fit">
            <Play size={14} /> はじめる
          </PrimaryButton>
        </Card>
        <Card className="p-5 flex flex-col gap-3">
          <div>
            <h3 className="font-display font-semibold flex items-center gap-2">
              <Trophy size={16} style={{ color: "var(--gold)" }} /> 全{items.length}問チャレンジ
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              {items.length}
              {unit}すべてをぶっ通しで出題。全問正解できたらほんものの実力！
            </p>
          </div>
          {Object.keys(kindTests["full"] || {}).length > 0 && <DifficultyMatrix records={kindTests["full"]} />}
          <PrimaryButton onClick={() => setMode({ type: "full" })} className="w-fit">
            <Play size={14} /> 挑戦する
          </PrimaryButton>
        </Card>
      </section>

      {/* 間違えた問題の復習 */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <RotateCcw size={16} style={{ color: "var(--mint)" }} /> 間違えた問題の復習
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              いままでのテストで間違えた問題: <span className="font-mono font-bold">{mistakeItems.length}</span>問。
              復習テストで正解すればリストから卒業！
            </p>
          </div>
          <div className="flex gap-2">
            <GhostButton onClick={() => setMode({ type: "practice" })} className={mistakeItems.length === 0 ? "opacity-40 pointer-events-none" : ""}>
              <Headphones size={14} /> 練習する
            </GhostButton>
            <IndigoButton onClick={() => setMode({ type: "mistake" })} disabled={mistakeItems.length === 0}>
              <Play size={14} /> 復習テスト
            </IndigoButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
 * テスト本体（ステージ / シャッフル / 全問 / 復習 共通）
 * ======================================================================= */

function TestRunner({ kind, mode, items, stages, buildQuestions, showText, speed, answerSec, update, speak, cancel, supported, onBack, onHome, onNextStageLearn }) {
  const isWord = kind === "word";
  const answerMs = answerSec * 1000; // 読み上げ終了後の回答制限時間
  const [questions, setQuestions] = useState(buildQuestions);
  const total = questions.length;

  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState("question"); // "question" | "finished"
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null); // 'correct' | 'wrong' | 'timeout' | null
  const [choices, setChoices] = useState([]);
  const [remainingMs, setRemainingMs] = useState(answerMs);
  const [countdownOn, setCountdownOn] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [wrongList, setWrongList] = useState([]);

  const timerRef = useRef(null);
  const capRef = useRef(null);
  const playTokenRef = useRef(0);
  const scoreRef = useRef(0);
  const wrongRef = useRef([]);
  const handleTimeoutRef = useRef(() => {});

  const current = questions[qIndex];

  const modeTitle =
    mode.type === "stage"
      ? `ステージ${mode.stageIndex + 1} テスト`
      : mode.type === "shuffle"
      ? "実力シャッフルテスト"
      : mode.type === "full"
      ? `全${total}問チャレンジ`
      : "間違い復習テスト";

  const scope =
    mode.type === "stage" ? `stage-${mode.stageIndex}` : mode.type === "shuffle" ? "shuffle" : mode.type === "full" ? "full" : "mistake";

  const clearTimers = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (capRef.current) window.clearTimeout(capRef.current);
  };

  const finish = (finalScore, finalWrongs) => {
    clearTimers();
    const diffKey = makeDiffKey(showText, speed, answerSec);
    const pass = finalScore === total && total > 0;
    const wasCleared = mode.type === "stage" ? stages[mode.stageIndex].cleared : false;

    update((prev) => {
      let next = withTestRecord(prev, kind, scope, diffKey, finalScore, total);
      if (pass && mode.type === "stage" && !wasCleared) {
        next = withPoints(next, CONFIG.STAGE_CLEAR_BONUS * (mode.stageIndex + 1));
      }
      return next;
    });

    if (pass && mode.type === "stage" && !wasCleared) {
      const m =
        kind === "custom"
          ? { title: `ステージ${mode.stageIndex + 1} クリア！`, msg: "自分で選んだフレーズも耳でマスター！" }
          : STAGE_CLEAR_MESSAGES[mode.stageIndex] || STAGE_CLEAR_MESSAGES[0];
      setCelebration({
        tier: Math.min(mode.stageIndex + 1, 5),
        title: m.title,
        message: m.msg,
        points: CONFIG.STAGE_CLEAR_BONUS * (mode.stageIndex + 1),
      });
    } else if (pass && mode.type === "full") {
      setCelebration({
        tier: 5,
        title: `全${total}問パーフェクト！`,
        message: `${kind === "word" ? "100単語" : kind === "sent" ? "100例文" : "マイリスト全問"}を一気に聞き取りきりました。おそるべし！`,
        points: 0,
      });
    }
    setPhase("finished");
  };

  const proceed = (curScore, curWrongs) => {
    if (qIndex + 1 >= total) {
      finish(curScore, curWrongs);
    } else {
      setQIndex((q) => q + 1);
    }
  };

  const handleAnswer = (choice) => {
    if (feedback || !current || phase !== "question") return;
    clearTimers();
    playTokenRef.current += 1;
    cancel();

    const correct = choice.id === current.id;
    setSelected(choice.id);
    setFeedback(correct ? "correct" : "wrong");

    let newScore = scoreRef.current;
    if (correct) {
      newScore = scoreRef.current + 1;
      scoreRef.current = newScore;
      setScore(newScore);
      update((prev) => {
        let next = withStudyDayMarked(withPoints(prev, CONFIG.POINTS_PER_CORRECT), kind);
        if (mode.type === "mistake") next = withMistakeCleared(next, kind, current.id);
        return next;
      });
    } else {
      const entry = { item: current, answer: choice.label };
      wrongRef.current = [...wrongRef.current, entry];
      setWrongList(wrongRef.current);
      update((prev) => withStudyDayMarked(withMistake(prev, kind, current.id), kind));
    }

    const delay = correct ? 650 : 1300;
    window.setTimeout(() => proceed(scoreRef.current, wrongRef.current), delay);
  };

  const handleTimeout = () => {
    if (feedback || !current || phase !== "question") return;
    clearTimers();
    playTokenRef.current += 1;
    cancel();
    setFeedback("timeout");
    const entry = { item: current, answer: null };
    wrongRef.current = [...wrongRef.current, entry];
    setWrongList(wrongRef.current);
    update((prev) => withStudyDayMarked(withMistake(prev, kind, current.id), kind));
    window.setTimeout(() => proceed(scoreRef.current, wrongRef.current), 1300);
  };
  handleTimeoutRef.current = handleTimeout;

  const replay = () => {
    if (feedback || !current) return;
    playTokenRef.current += 1;
    cancel();
    speak(current, { rate: speed });
  };

  const restart = () => {
    clearTimers();
    playTokenRef.current += 1;
    cancel();
    scoreRef.current = 0;
    wrongRef.current = [];
    setScore(0);
    setWrongList([]);
    setSelected(null);
    setFeedback(null);
    setCelebration(null);
    setQuestions(buildQuestions());
    setQIndex(0);
    setPhase("question");
  };

  // 新しい問題が始まるたびに: 選択肢を作る → 音声再生 → 読み上げ終了後にカウントダウン開始
  useEffect(() => {
    if (phase !== "question") return;
    const item = questions[qIndex];
    if (!item) return;
    setSelected(null);
    setFeedback(null);
    setChoices(buildChoices(items, item));
    setRemainingMs(answerMs);
    setCountdownOn(false);

    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();

    let started = false;
    const startCountdown = () => {
      if (started) return;
      if (playTokenRef.current !== token) return;
      started = true;
      setCountdownOn(true);
      const startT = Date.now();
      timerRef.current = window.setInterval(() => {
        const left = Math.max(0, answerMs - (Date.now() - startT));
        setRemainingMs(left);
        if (left <= 0) {
          window.clearInterval(timerRef.current);
          handleTimeoutRef.current();
        }
      }, 80);
    };

    speak(item, { rate: speed, onend: startCountdown });
    // onend が呼ばれない環境向けの保険（読み上げが長くても最大12秒でカウントダウン開始）
    capRef.current = window.setTimeout(startCountdown, 12000);

    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(capRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, questions, phase]);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel]);

  /* ---------------- 結果画面 ---------------- */
  if (phase === "finished") {
    const pass = score === total && total > 0;
    const nearMiss = !pass && score >= Math.ceil(total * CONFIG.NEAR_MISS_RATIO);
    return (
      <div className="space-y-5 animate-pop">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl sm:text-2xl font-bold">{modeTitle} の結果</h1>
          <GhostButton onClick={onBack} className="shrink-0">
            <ArrowLeft size={14} /> テストメニューへ
          </GhostButton>
        </div>

        <Card className="p-6 text-center space-y-3">
          <p className="text-xs font-mono" style={{ color: "var(--ink-soft)" }}>
            難易度: {diffLabel(showText, speed, answerSec)}
          </p>
          <p className="font-mono text-5xl font-bold">
            {score}
            <span className="text-2xl" style={{ color: "var(--ink-soft)" }}>
              /{total}
            </span>
          </p>
          {pass ? (
            <p className="font-display text-lg font-bold" style={{ color: "var(--mint)" }}>
              全問正解、合格です！🎉
            </p>
          ) : nearMiss ? (
            <p className="font-display text-lg font-bold" style={{ color: "var(--amber)" }}>
              おしい！もう一息！🔥
            </p>
          ) : (
            <p className="font-display text-base font-semibold" style={{ color: "var(--ink-soft)" }}>
              間違えた問題を振り返って、もう一度挑戦しよう！
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {pass && onNextStageLearn ? (
              // ステージテストに合格 → 次のステージの学習へ進むのが基本の流れ
              <PrimaryButton onClick={onNextStageLearn}>
                次のステージの学習に進む <ChevronRight size={14} />
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={restart}>
                <Repeat size={14} /> もう一度挑戦
              </PrimaryButton>
            )}
            {pass && onNextStageLearn && (
              <GhostButton onClick={restart}>
                <Repeat size={14} /> もう一度挑戦
              </GhostButton>
            )}
            <GhostButton onClick={onBack}>テストメニューへ戻る</GhostButton>
            {onHome && <GhostButton onClick={onHome}>ホームに戻る</GhostButton>}
          </div>
        </Card>

        {wrongList.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-display font-semibold flex items-center gap-2">
              <RotateCcw size={16} style={{ color: "var(--red)" }} /> 間違えた問題の振り返り（{wrongList.length}問）
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {wrongList.map((w, i) => (
                <Card key={`${w.item.id}-${i}`} className="p-4 flex items-start gap-3">
                  <button
                    aria-label="再生"
                    onClick={() => {
                      cancel();
                      speak(w.item, { rate: speed });
                    }}
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                    style={{ backgroundColor: "var(--indigo-soft)" }}
                  >
                    <Volume2 size={15} style={{ color: "var(--indigo)" }} />
                  </button>
                  <div className="min-w-0">
                    <p className="font-display font-semibold text-sm">{w.item.en}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--mint)" }}>
                      正解: {w.item.ja}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--red)" }}>
                      {w.answer ? `あなたの回答: ${w.answer}` : "時間切れ"}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
              間違えた問題は「間違えた問題の復習」にも追加されました。復習テストで正解すれば卒業です。
            </p>
          </section>
        )}

        {celebration && (
          <CelebrationModal
            tier={celebration.tier}
            title={celebration.title}
            message={celebration.message}
            points={celebration.points}
            onClose={() => setCelebration(null)}
          />
        )}
      </div>
    );
  }

  /* ---------------- 出題画面 ---------------- */
  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">{modeTitle}</h1>
          <p className="text-sm mt-1 font-mono" style={{ color: "var(--ink-soft)" }}>
            {diffLabel(showText, speed, answerSec)}・全問正解で合格
          </p>
        </div>
        <GhostButton onClick={onBack} className="shrink-0">
          <ArrowLeft size={14} /> 中断する
        </GhostButton>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono font-semibold"
          style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
        >
          問題 {Math.min(qIndex + 1, total)} / {total}
        </span>
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono"
          style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
        >
          <Check size={14} /> 正解 {score}
        </span>
        <div className="flex-1 min-w-[100px]">
          <ProgressBar value={qIndex} max={total} color="var(--indigo)" height={8} />
        </div>
      </div>

      <Card className="p-6 flex flex-col items-center gap-4">
        {showText ? (
          <p className="font-display text-3xl sm:text-4xl font-bold text-center">{current ? current.en : ""}</p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <EqualizerBars active size={36} barCount={5} color="var(--indigo)" />
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              音声をよく聞いて意味を選ぼう
            </p>
          </div>
        )}

        <button
          onClick={replay}
          disabled={!!feedback}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full disabled:opacity-40"
          style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
        >
          <Volume2 size={14} /> もう一度聞く
        </button>

        <div className="w-full max-w-sm">
          <CountdownBars remainingMs={countdownOn ? remainingMs : answerMs} totalMs={answerMs} />
          <p className="text-center font-mono text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
            {countdownOn ? `残り ${(remainingMs / 1000).toFixed(1)}秒` : "再生中…読み終わったらカウント開始"}
          </p>
        </div>

        {feedback && (
          <p
            className="font-semibold text-sm text-center"
            style={{ color: feedback === "correct" ? "var(--mint)" : "var(--red)" }}
          >
            {feedback === "correct"
              ? "正解！🎉"
              : feedback === "timeout"
              ? `時間切れ… 正解は「${current ? current.ja : ""}」`
              : `残念… 正解は「${current ? current.ja : ""}」`}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {choices.map((c) => {
          const isCorrect = current && c.id === current.id;
          const isSelected = c.id === selected;
          let bg = "var(--card)";
          let bd = "var(--line)";
          let tc = "var(--ink)";
          if (feedback) {
            if (isCorrect) {
              bg = "var(--mint-soft)";
              bd = "var(--mint)";
              tc = "var(--mint)";
            } else if (isSelected) {
              bg = "var(--red-soft)";
              bd = "var(--red)";
              tc = "var(--red)";
            }
          }
          return (
            <button
              key={c.id}
              disabled={!!feedback}
              onClick={() => handleAnswer(c)}
              className="rounded-2xl p-4 text-left text-base font-medium transition-colors disabled:cursor-not-allowed"
              style={{ backgroundColor: bg, border: `2px solid ${bd}`, color: tc }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
 * 間違えた問題の練習モード
 * ======================================================================= */

function MistakePractice({ kind, mistakeItems, mistakesMap, update, speak, cancel, onBack, onGoTest }) {
  const kindLabel = kind === "word" ? "単語" : kind === "custom" ? "マイリストの項目" : kind === "num" ? "数字" : "例文";
  const [speed, setSpeed] = useState(1.0);
  const [activeId, setActiveId] = useState(null);
  const playTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
    };
  }, [cancel]);

  const playOne = (item) => {
    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();
    setActiveId(item.id);
    // 数字は value からパーツ列を付けて渡す（付けないと TTS に落ちる）
    const target = kind === "num" && item && item.value != null ? { ...item, ...makeNumberSpeakTarget(item.value) } : item;
    speak(target, {
      rate: speed,
      onend: () => {
        if (playTokenRef.current === token) setActiveId(null);
      },
    });
  };

  const markShadow = (item) => {
    update((prev) => withStudyDayMarked(withShadow(prev, kind, item.id), kind));
  };

  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">間違えた問題の練習</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            苦手な{kindLabel}をまとめて聞き直そう。復習テストで正解すれば卒業！
          </p>
        </div>
        <GhostButton onClick={onBack} className="shrink-0">
          <ArrowLeft size={14} /> 戻る
        </GhostButton>
      </div>

      {mistakeItems.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-2xl mb-2">🎉</p>
          <p className="font-display font-semibold">復習まちの問題はありません！</p>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            テストで間違えた問題は自動でここに集まります。
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-4 flex flex-wrap items-center gap-4">
            <ControlGroup label="速度" icon={Gauge}>
              {CONFIG.LEARN_SPEEDS.map((v) => (
                <Chip key={v} active={speed === v} onClick={() => setSpeed(v)}>
                  {v.toFixed(1)}x
                </Chip>
              ))}
            </ControlGroup>
            <div className="ml-auto">
              <IndigoButton onClick={onGoTest}>
                <Play size={14} /> 復習テストに挑戦
              </IndigoButton>
            </div>
          </Card>

          <div className="grid sm:grid-cols-2 gap-3">
            {mistakeItems.map((item) => {
              const active = activeId === item.id;
              return (
                <Card key={item.id} active={active} className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display font-semibold text-base">{item.en}</p>
                      <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
                        {item.ja}
                      </p>
                    </div>
                    <button
                      aria-label="再生"
                      onClick={() => playOne(item)}
                      className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                      style={{ backgroundColor: active ? "var(--coral)" : "var(--coral-soft)" }}
                    >
                      {active ? <EqualizerBars active size={16} color="#ffffff" /> : <Play size={16} color="var(--coral)" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[11px] font-mono px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--red-soft)", color: "var(--red)" }}
                    >
                      ×{mistakesMap[item.id]}回 間違い
                    </span>
                    <ShadowButton onClick={() => markShadow(item)}>
                      <Check size={14} /> シャドーイングした！
                    </ShadowButton>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================================
 * マイリスト（自分で単語・例文を登録して、同じように練習＆テストできる）
 *  解放タイミングは CONFIG.CUSTOM_UNLOCK で選択（"start" / "stage1" / "complete"）
 * ======================================================================= */

function CustomScreen({
  state,
  update,
  stages,
  wordAll,
  sentAll,
  stage1Cleared,
  speak,
  cancel,
  makeUtterance,
  supported,
  voices,
  englishVoices,
  voiceURI,
  setVoiceURI,
  hasEnglishVoice,
}) {
  const [view, setView] = useState("manage"); // "manage" | "learn" | "test"
  const [en, setEn] = useState("");
  const [ja, setJa] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null);
  const items = state.customItems;

  // 1行を「英語 / 日本語」に分解する。区切りの優先順: タブ（Excel等からの貼り付け）→「|」→ 最後の半角カンマ
  // （英文にはカンマが含まれることがあるため、カンマは「最後の1つ」を区切りとして扱う）
  const parseBulkLine = (line) => {
    const t = line.trim();
    if (!t) return null;
    let idx = -1;
    if (t.includes("\t")) idx = t.indexOf("\t");
    else if (t.includes("|")) idx = t.indexOf("|");
    else idx = t.lastIndexOf(",");
    if (idx <= 0) return { error: t };
    const e = t.slice(0, idx).trim().replace(/^"(.*)"$/, "$1");
    const j = t.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!e || !j) return { error: t };
    return { en: e, ja: j };
  };

  const importBulk = () => {
    const lines = bulkText.split(/\r?\n/);
    const existing = new Set(items.map((it) => it.en.toLowerCase()));
    const added = [];
    let formatErrors = 0;
    let duplicates = 0;
    const stamp = Date.now();
    lines.forEach((line, i) => {
      const parsed = parseBulkLine(line);
      if (!parsed) return; // 空行
      if (parsed.error !== undefined) {
        formatErrors += 1;
        return;
      }
      const key = parsed.en.toLowerCase();
      if (existing.has(key)) {
        duplicates += 1;
        return;
      }
      existing.add(key);
      added.push({ id: `c${stamp}_${i}_${Math.floor(Math.random() * 10000)}`, en: parsed.en, ja: parsed.ja });
    });
    if (added.length > 0) {
      update((prev) => withCustomItemsAdded(prev, added));
      setBulkText("");
    }
    setBulkResult({ added: added.length, formatErrors, duplicates });
  };

  const locked =
    CONFIG.CUSTOM_UNLOCK === "complete"
      ? !(wordAll && sentAll)
      : CONFIG.CUSTOM_UNLOCK === "stage1"
      ? !stage1Cleared
      : false;
  const voiceProps = { voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice };

  if (locked) {
    return (
      <div className="space-y-5 animate-pop">
        <h1 className="font-display text-xl sm:text-2xl font-bold">⭐ マイリスト</h1>
        <Card className="p-8 text-center">
          <span
            className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: "var(--amber-soft)", color: "var(--gold)" }}
          >
            <Lock size={24} />
          </span>
          <p className="font-display font-semibold text-lg">
            {CONFIG.CUSTOM_UNLOCK === "complete" ? "全制覇のご褒美機能です 🎁" : "もう少しで解放されます 🔑"}
          </p>
          <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: "var(--ink-soft)" }}>
            {CONFIG.CUSTOM_UNLOCK === "complete"
              ? "100単語と100例文の全ステージテストに合格すると、自分の好きな単語・例文を登録して、同じように練習・テストできる「マイリスト」が解放されます。まずは全制覇を目指そう！"
              : "単語または例文のステージ1テストに合格すると、自分の好きな単語・例文を登録して、同じように練習・テストできる「マイリスト」が解放されます。まずはステージ1をクリアしよう！"}
          </p>
        </Card>
      </div>
    );
  }

  if (view === "learn") {
    return (
      <div className="space-y-4">
        <GhostButton onClick={() => setView("manage")}>
          <ArrowLeft size={14} /> マイリスト管理へ戻る
        </GhostButton>
        <LearnScreen
          kind="custom"
          stages={stages}
          state={state}
          update={update}
          speak={speak}
          cancel={cancel}
          makeUtterance={makeUtterance}
          supported={supported}
          onGoTest={() => setView("test")}
          {...voiceProps}
        />
      </div>
    );
  }

  if (view === "test") {
    return (
      <TestHub
        kind="custom"
        items={items}
        stages={stages}
        state={state}
        update={update}
        speak={speak}
        cancel={cancel}
        supported={supported}
        {...voiceProps}
        onExit={() => setView("manage")}
      />
    );
  }

  const addItem = () => {
    const e = en.trim();
    const j = ja.trim();
    if (!e || !j) return;
    update((prev) =>
      withCustomItemAdded(prev, {
        id: `c${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        en: e,
        ja: j,
      })
    );
    setEn("");
    setJa("");
  };

  const inputStyle = {
    borderColor: "var(--line)",
    backgroundColor: "var(--bg-soft)",
    color: "var(--ink)",
  };

  return (
    <div className="space-y-5 animate-pop">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold">⭐ マイリスト</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
          自分の覚えたい単語・例文を登録すると、100単語・100例文と同じように練習とテストができます。
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-semibold font-display flex items-center gap-2">
          <Plus size={16} /> 単語・例文を追加
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            placeholder="英語（例: See you later.）"
            className="flex-1 text-sm rounded-full px-4 py-2 border min-w-0"
            style={inputStyle}
          />
          <input
            type="text"
            value={ja}
            onChange={(e) => setJa(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
            placeholder="日本語の意味（例: またあとで。）"
            className="flex-1 text-sm rounded-full px-4 py-2 border min-w-0"
            style={inputStyle}
          />
          <PrimaryButton onClick={addItem} disabled={!en.trim() || !ja.trim()}>
            <Plus size={14} /> 追加
          </PrimaryButton>
        </div>
        <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
          {CONFIG.STAGE_SIZE}個を超えると自動で複数ステージに分かれます。テストは4択の選択肢を作るため4個以上の登録が必要です。
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-semibold font-display flex items-center gap-2">
          <ListPlus size={16} /> まとめて登録（データ流し込み）
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={6}
          placeholder={"1行に1つ、「英語,日本語」の形式で貼り付けてください。\nExcelやスプレッドシートの2列（英語｜日本語）をコピーしてそのまま貼り付けてもOKです。\n\n例:\nSee you later.,またあとで。\nI made it!,間に合った！"}
          className="w-full text-sm rounded-xl px-4 py-3 border min-w-0 font-mono"
          style={{
            borderColor: "var(--line)",
            backgroundColor: "var(--bg-soft)",
            color: "var(--ink)",
            resize: "vertical",
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={importBulk} disabled={!bulkText.trim()}>
            <ListPlus size={14} /> 読み込んで登録
          </PrimaryButton>
          <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
            区切りはタブ・「|」・最後の半角カンマの順で判定します（英文の途中のカンマはOK）
          </span>
        </div>
        {bulkResult && (
          <NoticeBanner
            tone={bulkResult.added > 0 ? "amber" : "red"}
            text={
              `${bulkResult.added}件を登録しました。` +
              (bulkResult.duplicates > 0 ? ` 重複スキップ ${bulkResult.duplicates}件。` : "") +
              (bulkResult.formatErrors > 0
                ? ` 形式を読み取れずスキップ ${bulkResult.formatErrors}件（「英語,日本語」の形になっているか確認してください）。`
                : "")
            }
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm px-3 py-1.5 rounded-full" style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}>
          登録 {items.length}個
        </span>
        <div className="ml-auto flex gap-2">
          <PrimaryButton onClick={() => setView("learn")} disabled={items.length === 0}>
            <Headphones size={14} /> 練習する
          </PrimaryButton>
          <IndigoButton onClick={() => setView("test")} disabled={items.length < 4}>
            <ListChecks size={14} /> テストする
          </IndigoButton>
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-2xl mb-2">📝</p>
          <p className="font-display font-semibold">まだ何も登録されていません</p>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            上のフォームから、覚えたい単語や例文を追加してみましょう。
          </p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4 flex items-start gap-3">
              <button
                aria-label="再生"
                onClick={() => {
                  cancel();
                  speak(item, { rate: 1.0 });
                }}
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                style={{ backgroundColor: "var(--coral-soft)" }}
              >
                <Play size={15} color="var(--coral)" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="font-display font-semibold text-sm break-words">{item.en}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
                  {item.ja}
                </p>
              </div>
              <button
                aria-label="削除"
                onClick={() => update((prev) => withCustomItemRemoved(prev, item.id))}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                style={{ backgroundColor: "var(--red-soft)" }}
              >
                <Trash2 size={14} style={{ color: "var(--red)" }} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
 * 数字学習: -teen / -ty 聞き分けドリル
 * ======================================================================= */

function TeenTyDrill({ speak, cancel }) {
  const [speed, setSpeed] = useState(1.0);
  const [activeKey, setActiveKey] = useState(null);
  const playTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
    };
  }, [cancel]);

  const playValue = (v) => {
    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();
    setActiveKey(String(v));
    speak(makeNumberSpeakTarget(v), {
      rate: speed,
      onend: () => {
        if (playTokenRef.current === token) setActiveKey(null);
      },
    });
  };

  // ペアを交互に2周再生: a → b → a → b（間に短いポーズ）
  const playAlternate = (a, b) => {
    playTokenRef.current += 1;
    const token = playTokenRef.current;
    cancel();
    const seq = [a, b, a, b];
    let i = 0;
    const step = () => {
      if (playTokenRef.current !== token) return;
      if (i >= seq.length) {
        setActiveKey(null);
        return;
      }
      const v = seq[i++];
      setActiveKey(String(v));
      speak(makeNumberSpeakTarget(v), {
        rate: speed,
        onend: () => {
          if (playTokenRef.current === token) window.setTimeout(step, 450 / speed);
        },
      });
    };
    step();
  };

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold flex items-center gap-2">
          <Headphones size={16} style={{ color: "var(--coral)" }} /> -teen / -ty 聞き分けドリル
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
          数字リスニング最大の難所、13(thirteen)と30(thirty)のような紛らわしいペア。「交互」ボタンで聞き比べて耳を慣らそう。
        </p>
      </div>
      <ControlGroup label="速度" icon={Gauge}>
        {CONFIG.LEARN_SPEEDS.map((v) => (
          <Chip key={v} active={speed === v} onClick={() => setSpeed(v)}>
            {v.toFixed(1)}x
          </Chip>
        ))}
      </ControlGroup>
      <div className="grid sm:grid-cols-2 gap-3">
        {TEEN_TY_PAIRS.map(([a, b]) => (
          <Card key={a} className="p-3 flex items-center gap-2">
            <button
              onClick={() => playValue(a)}
              className="flex-1 min-w-0 rounded-xl px-3 py-2 text-left active:scale-95 transition-transform"
              style={{
                backgroundColor: activeKey === String(a) ? "var(--coral-soft)" : "var(--bg-soft)",
                border: `1px solid ${activeKey === String(a) ? "var(--coral)" : "var(--line)"}`,
              }}
            >
              <p className="font-mono font-bold">{a}</p>
              <p className="text-[11px] truncate" style={{ color: "var(--ink-soft)" }}>
                {numToWords(a)}
              </p>
            </button>
            <button
              onClick={() => playValue(b)}
              className="flex-1 min-w-0 rounded-xl px-3 py-2 text-left active:scale-95 transition-transform"
              style={{
                backgroundColor: activeKey === String(b) ? "var(--indigo-soft)" : "var(--bg-soft)",
                border: `1px solid ${activeKey === String(b) ? "var(--indigo)" : "var(--line)"}`,
              }}
            >
              <p className="font-mono font-bold">{b}</p>
              <p className="text-[11px] truncate" style={{ color: "var(--ink-soft)" }}>
                {numToWords(b)}
              </p>
            </button>
            <ShadowButton onClick={() => playAlternate(a, b)}>
              <Repeat size={13} /> 交互
            </ShadowButton>
          </Card>
        ))}
      </div>
    </Card>
  );
}

/* =========================================================================
 * 数字学習: 発音チェック（数字を見て発音 → 綴り表示＋お手本再生 → 自己採点）
 *  - そのステージの桁のみから NUM_PRONOUNCE_SIZE 問ランダム出題
 *  - 記録は残さない（その場限りの練習）。全問「できた」ならテストへの導線を出す
 * ======================================================================= */

function PronunciationPractice({ stage, stageIndex, speed = 1.0, speak, cancel, update, onBack, onNext }) {
  const [questions, setQuestions] = useState(() =>
    shuffle(stage.items.map((it) => it.value)).slice(0, Math.min(CONFIG.NUM_PRONOUNCE_SIZE, stage.items.length))
  );
  const [qIndex, setQIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState([]);
  const playTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
    };
  }, [cancel]);

  const play = (value) => {
    playTokenRef.current += 1;
    cancel();
    speak(makeNumberSpeakTarget(value), { rate: speed });
  };

  const restart = () => {
    playTokenRef.current += 1;
    cancel();
    setQuestions(
      shuffle(stage.items.map((it) => it.value)).slice(0, Math.min(CONFIG.NUM_PRONOUNCE_SIZE, stage.items.length))
    );
    setQIndex(0);
    setRevealed(false);
    setResults([]);
  };

  const grade = (ok) => {
    const next = [...results, ok];
    setResults(next);
    if (qIndex + 1 >= questions.length) {
      // 完了。全問「言えた」なら合格として記録し、テスト2を解放する
      const correct = next.filter(Boolean).length;
      if (correct === questions.length) {
        update((prev) =>
          withStudyDayMarked(
            withTestRecord(prev, "num", `stage-${stageIndex}-t1`, "self", correct, questions.length),
            "num"
          )
        );
      }
      setQIndex(questions.length);
    } else {
      setQIndex(qIndex + 1);
      setRevealed(false);
    }
  };

  // 完了画面
  if (qIndex >= questions.length) {
    const correct = results.filter(Boolean).length;
    const allOk = correct === questions.length;
    return (
      <div className="space-y-5 animate-pop">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl sm:text-2xl font-bold">
            テスト1「自分で言えるかチェック」の結果
          </h1>
          <GhostButton onClick={onBack} className="shrink-0">
            <ArrowLeft size={14} /> テストメニューへ
          </GhostButton>
        </div>
        <Card className="p-6 text-center space-y-3">
          <p className="font-mono text-5xl font-bold">
            {correct}
            <span className="text-2xl" style={{ color: "var(--ink-soft)" }}>
              /{questions.length}
            </span>
          </p>
          {allOk ? (
            <>
              <p className="font-display text-lg font-bold" style={{ color: "var(--mint)" }}>
                全問クリア！合格です 🎉
              </p>
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                次は「練習した問題のテスト」に進みましょう。
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              言えなかった数字をもう一度練習して、全問言えるようになったら次に進めます。
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {allOk && onNext ? (
              <PrimaryButton onClick={onNext}>
                次のテストへ進む <ChevronRight size={14} />
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={restart}>
                <Repeat size={14} /> もう一度
              </PrimaryButton>
            )}
            <GhostButton onClick={onBack}>テストメニューへ戻る</GhostButton>
          </div>
        </Card>
      </div>
    );
  }

  // 出題中
  const value = questions[qIndex];
  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">テスト1「自分で言えるかチェック」</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            ステージ{stageIndex + 1}「{NUM_STAGE_TITLES[stageIndex]}」・全問言えたら合格
          </p>
        </div>
        <GhostButton onClick={onBack} className="shrink-0">
          <ArrowLeft size={14} /> 中断する
        </GhostButton>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono font-semibold"
          style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
        >
          問題 {qIndex + 1} / {questions.length}
        </span>
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono"
          style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
        >
          <Check size={14} /> 言えた {results.filter(Boolean).length}
        </span>
        <div className="flex-1 min-w-[100px]">
          <ProgressBar value={qIndex} max={questions.length} color="var(--indigo)" height={8} />
        </div>
      </div>

      <Card className="p-6 flex flex-col items-center gap-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          この数字を英語で声に出して言ってみよう
        </p>
        <p className="font-mono text-5xl font-bold">{fmtNum(value)}</p>

        {!revealed ? (
          <PrimaryButton
            onClick={() => {
              setRevealed(true);
              play(value);
            }}
          >
            <Volume2 size={16} /> 答えを見る・聞く
          </PrimaryButton>
        ) : (
          <div className="w-full flex flex-col items-center gap-3 animate-pop">
            <div className="text-center">
              <p className="font-display text-lg font-semibold" style={{ color: "var(--mint)" }}>
                {numToWords(value)}
              </p>
              <button
                onClick={() => play(value)}
                className="mt-1 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full active:scale-95 transition-transform"
                style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
              >
                <Volume2 size={14} /> もう一度聞く
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              言えていたかな？自己採点で次へ
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => grade(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold active:scale-95 transition-transform"
                style={{ backgroundColor: "var(--red-soft)", color: "var(--red)" }}
              >
                言えなかった
              </button>
              <button
                onClick={() => grade(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-white active:scale-95 transition-transform"
                style={{ backgroundColor: "var(--mint)" }}
              >
                <Check size={15} /> 言えた
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* =========================================================================
 * 数字テスト（音声を聞いて数字を入力。時間制限なし・聞き直し自由）
 * ======================================================================= */

// 数字テストの難易度キーは速度のみ（英文表示・回答時間の軸はない）
const numDiffKey = (speed) => `spd|${Number(speed).toFixed(1)}`;

function NumberRecordChips({ records = {} }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {CONFIG.TEST_SPEEDS.map((sp) => {
        const rec = records[numDiffKey(sp)];
        const cleared = rec && rec.cleared;
        const tried = rec && !cleared && rec.best > 0;
        return (
          <span
            key={sp}
            className="text-[11px] font-mono px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: cleared ? "var(--mint-soft)" : "var(--bg-soft)",
              color: cleared ? "var(--mint)" : tried ? "var(--amber)" : "var(--ink-soft)",
              border: cleared ? "1px solid var(--mint)" : "1px solid transparent",
            }}
            title={cleared ? "この速度で全問正解済み" : tried ? `自己ベスト ${rec.best}/${rec.total}` : "未挑戦"}
          >
            {sp.toFixed(1)}x {cleared ? "✓" : tried ? `${rec.best}/${rec.total}` : "・"}
          </span>
        );
      })}
    </div>
  );
}

function NumberTestHub({
  stages,
  state,
  update,
  speak,
  cancel,
  supported,
  voices,
  englishVoices,
  voiceURI,
  setVoiceURI,
  hasEnglishVoice,
  onExit,
  onHome,
  onGoStageLearn,
}) {
  const numTestPrefs = (state.settings && state.settings.numTestPrefs) || {};
  const [speed, setSpeedRaw] = useState(numTestPrefs.speed || 1.0);
  const [digits, setDigitsRaw] = useState(numTestPrefs.digits || 2);
  const setSpeed = (v) => {
    setSpeedRaw(v);
    update((prev) => withNumTestPrefs(prev, { speed: v }));
  };
  const setDigits = (v) => {
    setDigitsRaw(v);
    update((prev) => withNumTestPrefs(prev, { digits: v }));
  };
  const [mode, setMode] = useState(null); // {type:"stage",stageIndex} | {type:"random",digits} | {type:"mistake",items} | {type:"practice"}

  const kindTests = state.tests.num || {};
  const mistakesMap = state.mistakes.num || {};
  const mistakeItems = useMemo(() => NUMBERS.filter((it) => mistakesMap[it.id]), [mistakesMap]);
  const voiceProps = { supported, voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice };

  if (mode && mode.type === "practice") {
    return (
      <MistakePractice
        kind="num"
        mistakeItems={mistakeItems}
        mistakesMap={mistakesMap}
        update={update}
        speak={speak}
        cancel={cancel}
        onBack={() => setMode(null)}
        onGoTest={() => setMode({ type: "mistake", items: mistakeItems })}
      />
    );
  }

  if (mode && mode.type === "speak") {
    return (
      <PronunciationPractice
        stage={stages[mode.stageIndex]}
        stageIndex={mode.stageIndex}
        speak={speak}
        cancel={cancel}
        update={update}
        speed={speed}
        onBack={() => setMode(null)}
        onNext={() => setMode({ type: "stage", stageIndex: mode.stageIndex, level: 2 })}
      />
    );
  }

  if (mode) {
    const curStage = mode.type === "stage" ? stages[mode.stageIndex] : null;
    // このテストがそのステージの最終テストか（ステージ1はテスト2が最終、それ以外はテスト3）
    const isFinalTest =
      curStage && (curStage.hasLevel3 ? mode.level === 3 : mode.level === 2);
    const nextStage = curStage ? stages[curStage.index + 1] : null;
    return (
      <NumberTestRunner
        // モードが変わったら必ず作り直す（前のテストの終了状態が残るのを防ぐ）
        key={`${mode.type}-${mode.stageIndex ?? ""}-${mode.level ?? ""}-${mode.digits ?? ""}`}
        mode={mode}
        stages={stages}
        speed={speed}
        update={update}
        speak={speak}
        cancel={cancel}
        onBack={() => setMode(null)}
        onHome={onHome}
        onNextLevel={
          mode.type === "stage" && mode.level === 2 && curStage && curStage.hasLevel3
            ? () => setMode({ type: "stage", stageIndex: mode.stageIndex, level: 3 })
            : null
        }
        onNextStageLearn={
          isFinalTest && nextStage && onGoStageLearn
            ? () => onGoStageLearn(nextStage.index)
            : null
        }
      />
    );
  }

  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">数字リスニングテスト</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            音声を聞いて数字を入力。時間制限なし、「もう一度聞く」で何度でも聞き直せます。全問正解で合格。
          </p>
        </div>
        <GhostButton onClick={onExit} className="shrink-0">
          <ArrowLeft size={14} /> ホームへ
        </GhostButton>
      </div>

      {!supported && <NoticeBanner text="この端末は音声合成に対応していないため、タイミングを再現したダミー再生で進行します。" />}
      {supported && <VoiceSettings {...voiceProps} />}

      <Card className="p-4 space-y-2">
        <p className="text-sm font-semibold font-display flex items-center gap-2">
          <Gauge size={16} /> 速度（この速度ごとに合格記録が残ります）
        </p>
        <div className="flex gap-1 flex-wrap">
          {CONFIG.TEST_SPEEDS.map((v) => (
            <Chip key={v} active={speed === v} onClick={() => setSpeed(v)}>
              {v.toFixed(1)}x
            </Chip>
          ))}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-2">
          <Target size={16} /> ステージテスト
        </h2>
        {stages.map((st) => {
          const lv = st.levels || [];
          const lvUnlocked = st.levelUnlocked || [false, false, false];
          const steps = [
            {
              n: 1,
              title: "自分で言えるかチェック",
              desc: "数字を見て英語で言えるか確認（自己採点）",
              icon: Mic,
              color: "var(--coral)",
            },
            {
              n: 2,
              title: "練習した問題のテスト",
              desc: "このステージで練習した数字を聞いて入力",
              icon: Headphones,
              color: "var(--indigo)",
            },
            // ステージ1は練習した問題＝範囲全体なので、ランダムテストは置かない
            ...(st.hasLevel3
              ? [
                  {
                    n: 3,
                    title: "ランダムテスト",
                    desc: `${NUM_STAGE_TITLES[st.index]}の範囲からランダム出題`,
                    icon: ShuffleIcon,
                    color: "var(--mint)",
                  },
                ]
              : []),
          ];
          return (
            <Card key={st.index} className="p-4 space-y-3">
              <p className="font-display font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                ステージ{st.index + 1}「{NUM_STAGE_TITLES[st.index]}」
                {st.cleared && (
                  <span
                    className="flex items-center gap-0.5 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
                  >
                    <CheckCircle2 size={11} /> ステージクリア
                  </span>
                )}
                {!st.unlocked && (
                  <span
                    className="flex items-center gap-0.5 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
                  >
                    <Lock size={11} /> 前ステージをクリアで解放
                  </span>
                )}
              </p>

              {st.unlocked && (
                <div className="space-y-2">
                  {steps.map((s, i) => {
                    const done = lv[i] && lv[i].cleared;
                    const open = lvUnlocked[i];
                    const Icon = s.icon;
                    // 「次にやるべき」= 解放済みで未合格の最初のもの
                    const isNext = open && !done && !steps.slice(0, i).some((_, j) => lvUnlocked[j] && !(lv[j] && lv[j].cleared));
                    return (
                      <div
                        key={s.n}
                        className="rounded-xl p-3 flex flex-wrap items-center gap-x-3 gap-y-2"
                        style={{
                          backgroundColor: done ? "var(--mint-soft)" : open ? "var(--card)" : "var(--bg-soft)",
                          border: `1px solid ${isNext ? s.color : done ? "var(--mint)" : "var(--line)"}`,
                          opacity: open ? 1 : 0.6,
                        }}
                      >
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-mono font-bold"
                          style={{
                            backgroundColor: done ? "var(--mint)" : open ? s.color : "var(--line)",
                            color: "#fff",
                          }}
                        >
                          {done ? <Check size={14} /> : s.n}
                        </span>
                        <div className="min-w-[150px] flex-1">
                          <p className="text-sm font-semibold flex items-center gap-1.5">
                            <Icon size={13} style={{ color: done ? "var(--mint)" : s.color }} />
                            {s.title}
                            {isNext && (
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: s.color, color: "#fff" }}
                              >
                                次はここ
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-soft)" }}>
                            {s.desc}
                          </p>
                          {s.n > 1 && lv[i] && Object.keys(lv[i].records).length > 0 && (
                            <div className="mt-1">
                              <NumberRecordChips records={lv[i].records} />
                            </div>
                          )}
                        </div>
                        <div className="ml-auto">
                          {open ? (
                            <IndigoButton
                              onClick={() =>
                                setMode(
                                  s.n === 1
                                    ? { type: "speak", stageIndex: st.index }
                                    : { type: "stage", stageIndex: st.index, level: s.n }
                                )
                              }
                            >
                              <Play size={14} /> {done ? "もう一度" : "はじめる"}
                            </IndigoButton>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-[11px] font-semibold"
                              style={{ backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }}
                            >
                              <Lock size={12} />
                              {i === 0 ? "音読を完了すると解放" : `テスト${i}に合格すると解放`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </section>

      <Card className="p-5 space-y-3">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-2">
            <ShuffleIcon size={16} style={{ color: "var(--coral)" }} /> 実力試しコーナー
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
            選んだ上限までの桁がミックスで{CONFIG.NUM_RANDOM_TEST_SIZE}問出題（例: 5桁を選ぶと1〜5桁が混ざる）。毎回違う数字が出ます。最終目標は5桁ミックス！
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ControlGroup label="上限の桁数" icon={Hash}>
            {CONFIG.NUM_DIGIT_CHOICES.map((d) => (
              <Chip key={d} active={digits === d} onClick={() => setDigits(d)}>
                〜{d}桁
              </Chip>
            ))}
          </ControlGroup>
          <div className="ml-auto">
            <PrimaryButton onClick={() => setMode({ type: "random", digits })}>
              <Play size={14} /> はじめる
            </PrimaryButton>
          </div>
        </div>
        <div className="space-y-1.5">
          {CONFIG.NUM_DIGIT_CHOICES.map((d) =>
            Object.keys(kindTests[`rand-${d}`] || {}).length > 0 ? (
              <div key={d} className="flex items-center gap-2">
                <span className="text-[11px] font-mono w-12 shrink-0" style={{ color: "var(--ink-soft)" }}>
                  〜{d}桁
                </span>
                <NumberRecordChips records={kindTests[`rand-${d}`]} />
              </div>
            ) : null
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <RotateCcw size={16} style={{ color: "var(--mint)" }} /> 間違えた数字の復習
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              ステージテストで間違えた数字: <span className="font-mono font-bold">{mistakeItems.length}</span>問。
              復習テストで正解すれば卒業！（ランダム問題は毎回変わるため対象外）
            </p>
          </div>
          <div className="flex gap-2">
            <GhostButton
              onClick={() => setMode({ type: "practice" })}
              className={mistakeItems.length === 0 ? "opacity-40 pointer-events-none" : ""}
            >
              <Headphones size={14} /> 練習する
            </GhostButton>
            <IndigoButton onClick={() => setMode({ type: "mistake", items: mistakeItems })} disabled={mistakeItems.length === 0}>
              <Play size={14} /> 復習テスト
            </IndigoButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

function NumberTestRunner({ mode, stages, speed, update, speak, cancel, onBack, onHome, onNextLevel, onNextStageLearn }) {
  const buildQuestions = useCallback(() => {
    if (mode.type === "stage") {
      if (mode.level === 3) {
        // テスト3: そのステージの範囲からランダム出題
        // ステージ2（2桁）は -teen/-ty の聞き分けが最重要なので、紛らわしい数字を多めに混ぜる。
        if (mode.stageIndex === 1) {
          const size = CONFIG.NUM_STAGE_RANDOM_SIZE;
          // 混乱ペアの構成要素: 13〜19（-teen）と 30/40/50/60/70/80/90（-ty）
          const teens = [13, 14, 15, 16, 17, 18, 19];
          const tys = [30, 40, 50, 60, 70, 80, 90];
          const confusable = [...teens, ...tys];
          // 全体の約6割を混乱ペアから出題（両方の型がしっかり出るようにする）
          const confCount = Math.min(confusable.length, Math.round(size * 0.6));
          const picked = shuffle(confusable).slice(0, confCount);
          // 残りは他の2桁（混乱ペアの丸め数を除く一般的な2桁）から補充
          const rest = size - picked.length;
          const fillPool = [];
          for (let n = 10; n <= 99; n++) {
            if (confusable.includes(n)) continue;
            fillPool.push(n);
          }
          const fill = shuffle(fillPool).slice(0, rest);
          return shuffle([...picked, ...fill]).map((v) => ({ id: null, value: v }));
        }
        const r = NUM_STAGE_RANDOM_RANGE[mode.stageIndex];
        return genRangeNumbers(r.min, r.max, CONFIG.NUM_STAGE_RANDOM_SIZE).map((v) => ({ id: null, value: v }));
      }
      // テスト2: そのステージで練習した問題（＋テスト専用の追加項目）から出題
      return shuffle(NUM_STAGE_TEST_ITEMS[mode.stageIndex]).map((it) => ({ id: it.id, value: it.value }));
    }
    if (mode.type === "random")
      return genMixedRandomNumbers(mode.digits, CONFIG.NUM_RANDOM_TEST_SIZE).map((v) => ({ id: null, value: v }));
    return shuffle(mode.items || []).map((it) => ({ id: it.id, value: it.value }));
  }, [mode, stages]);

  const [questions, setQuestions] = useState(buildQuestions);
  const total = questions.length;
  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState("question"); // "question" | "finished"
  const [score, setScore] = useState(0);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState(null); // null | "correct" | "wrong"
  const [wrongList, setWrongList] = useState([]);
  const [celebration, setCelebration] = useState(null);

  const scoreRef = useRef(0);
  const wrongRef = useRef([]);
  const playTokenRef = useRef(0);
  const inputRef = useRef(null);

  // 入力欄にフォーカスを戻す（Enter確定後・「もう一度聞く」後・次の問題でもキーボード入力を続けられるように）
  const focusInput = useCallback(() => {
    const focus = () => {
      const el = inputRef.current;
      if (el && !el.disabled) el.focus();
    };
    // ボタンクリック直後やDOM更新直後でも確実に当たるよう、複数タイミングで試行
    window.setTimeout(focus, 0);
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus);
  }, []);

  const current = questions[qIndex];

  const modeTitle =
    mode.type === "stage"
      ? mode.level === 3
        ? `テスト3「ランダムテスト」ステージ${mode.stageIndex + 1}`
        : `テスト2「練習した問題」ステージ${mode.stageIndex + 1}`
      : mode.type === "random"
      ? `実力試し（1〜${mode.digits}桁ミックス）`
      : "間違い復習テスト";

  const scope =
    mode.type === "stage"
      ? `stage-${mode.stageIndex}-t${mode.level || 2}`
      : mode.type === "random"
      ? `rand-${mode.digits}`
      : "mistake";

  const playCurrent = useCallback(
    (value) => {
      playTokenRef.current += 1;
      cancel();
      speak(makeNumberSpeakTarget(value), { rate: speed });
      focusInput(); // 再生ボタンを押しても入力を続けられるようにフォーカスを戻す
    },
    [cancel, speak, speed, focusInput]
  );

  // 出題が変わるたびに自動で1回読み上げ、入力欄にフォーカスを戻す
  useEffect(() => {
    if (phase !== "question") return;
    const q = questions[qIndex];
    if (!q) return;
    setInput("");
    setFeedback(null);
    playCurrent(q.value);
    focusInput(); // key変更で入力欄が作り直されるため、新しい欄に明示的にフォーカスを当てる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, questions, phase]);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel]);

  const finish = (finalScore) => {
    const pass = finalScore === total && total > 0;
    // ステージクリア＝そのステージの最終テストに合格したとき（ステージ1はテスト2が最終）
    const curStage = mode.type === "stage" ? stages[mode.stageIndex] : null;
    const isStageClear =
      !!curStage && (curStage.hasLevel3 ? mode.level === 3 : mode.level === 2);
    const wasCleared = isStageClear ? stages[mode.stageIndex].cleared : false;
    update((prev) => {
      let next = withTestRecord(prev, "num", scope, numDiffKey(speed), finalScore, total);
      if (pass && isStageClear && !wasCleared) {
        next = withPoints(next, CONFIG.STAGE_CLEAR_BONUS * (mode.stageIndex + 1));
      }
      return next;
    });
    if (pass && isStageClear && !wasCleared) {
      const hasNext = mode.stageIndex + 1 < stages.length;
      setCelebration({
        tier: Math.min(mode.stageIndex + 1, 5),
        title: `🎊 数字ステージ${mode.stageIndex + 1} クリア！`,
        message: hasNext
          ? `「${NUM_STAGE_TITLES[mode.stageIndex]}」を聞き取れるようになりました！ステージ${
              mode.stageIndex + 2
            }「${NUM_STAGE_TITLES[mode.stageIndex + 1]}」の学習が解放されました。`
          : `「${NUM_STAGE_TITLES[mode.stageIndex]}」を聞き取れるようになりました！数字は全ステージ制覇です！`,
        points: CONFIG.STAGE_CLEAR_BONUS * (mode.stageIndex + 1),
      });
    }
    setPhase("finished");
  };

  const proceed = () => {
    if (qIndex + 1 >= total) {
      finish(scoreRef.current);
    } else {
      setQIndex((q) => q + 1);
    }
  };

  const submit = () => {
    if (!current || feedback === "correct" || phase !== "question" || input === "") return;
    playTokenRef.current += 1;
    cancel();
    const val = parseInt(input, 10);
    const correct = val === current.value;
    if (correct) {
      // 間違い→打ち直して正解した場合も、この問題はすでに不正解としてカウント済み
      const alreadyWrong = feedback === "wrong";
      setFeedback("correct");
      if (!alreadyWrong) {
        scoreRef.current += 1;
        setScore(scoreRef.current);
        update((prev) => {
          let next = withStudyDayMarked(withPoints(prev, CONFIG.POINTS_PER_CORRECT), "num");
          if (mode.type === "mistake" && current.id) next = withMistakeCleared(next, "num", current.id);
          return next;
        });
      }
      window.setTimeout(proceed, 900);
    } else {
      if (feedback !== "wrong") {
        // この問題で初めての不正解のときだけ記録
        wrongRef.current = [...wrongRef.current, { value: current.value, answer: input }];
        setWrongList(wrongRef.current);
        update((prev) => {
          let next = withStudyDayMarked(prev, "num");
          if (current.id) next = withMistake(next, "num", current.id);
          return next;
        });
      }
      setFeedback("wrong");
      setInput(""); // 入力をクリアしてすぐ打ち直せるように
      focusInput(); // Enterで確定した後もキーボード入力を続けられるようにフォーカスを戻す
    }
  };

  const restart = () => {
    playTokenRef.current += 1;
    cancel();
    scoreRef.current = 0;
    wrongRef.current = [];
    setScore(0);
    setWrongList([]);
    setInput("");
    setFeedback(null);
    setCelebration(null);
    setQuestions(buildQuestions());
    setQIndex(0);
    setPhase("question");
  };

  /* ---------------- 結果画面 ---------------- */
  if (phase === "finished") {
    const pass = score === total && total > 0;
    const nearMiss = !pass && score >= Math.ceil(total * CONFIG.NEAR_MISS_RATIO);
    return (
      <div className="space-y-5 animate-pop">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl sm:text-2xl font-bold">{modeTitle} の結果</h1>
          <GhostButton onClick={onBack} className="shrink-0">
            <ArrowLeft size={14} /> テストメニューへ
          </GhostButton>
        </div>

        <Card className="p-6 text-center space-y-3">
          <p className="text-xs font-mono" style={{ color: "var(--ink-soft)" }}>
            速度: {speed.toFixed(1)}x・時間制限なし
          </p>
          <p className="font-mono text-5xl font-bold">
            {score}
            <span className="text-2xl" style={{ color: "var(--ink-soft)" }}>
              /{total}
            </span>
          </p>
          {pass ? (
            <p className="font-display text-lg font-bold" style={{ color: "var(--mint)" }}>
              全問正解、合格です！🎉
            </p>
          ) : nearMiss ? (
            <p className="font-display text-lg font-bold" style={{ color: "var(--amber)" }}>
              おしい！もう一息！🔥
            </p>
          ) : (
            <p className="font-display text-base font-semibold" style={{ color: "var(--ink-soft)" }}>
              間違えた数字を振り返って、もう一度挑戦しよう！
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {pass && onNextStageLearn ? (
              // ステージの最終テストに合格 → 次のステージの学習へ進むのが基本の流れ
              <PrimaryButton onClick={onNextStageLearn}>
                次のステージの学習に進む <ChevronRight size={14} />
              </PrimaryButton>
            ) : pass && onNextLevel ? (
              <PrimaryButton onClick={onNextLevel}>
                次のテストへ進む <ChevronRight size={14} />
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={restart}>
                <Repeat size={14} /> もう一度挑戦
              </PrimaryButton>
            )}
            {pass && (onNextStageLearn || onNextLevel) && (
              <GhostButton onClick={restart}>
                <Repeat size={14} /> もう一度挑戦
              </GhostButton>
            )}
            <GhostButton onClick={onBack}>テストメニューへ戻る</GhostButton>
            {onHome && <GhostButton onClick={onHome}>ホームに戻る</GhostButton>}
          </div>
        </Card>

        {wrongList.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-display font-semibold flex items-center gap-2">
              <RotateCcw size={16} style={{ color: "var(--red)" }} /> 間違えた数字の振り返り（{wrongList.length}問）
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {wrongList.map((w, i) => (
                <Card key={`${w.value}-${i}`} className="p-4 flex items-start gap-3">
                  <button
                    aria-label="再生"
                    onClick={() => {
                      cancel();
                      speak(makeNumberSpeakTarget(w.value), { rate: speed });
                    }}
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                    style={{ backgroundColor: "var(--indigo-soft)" }}
                  >
                    <Volume2 size={15} style={{ color: "var(--indigo)" }} />
                  </button>
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-lg">{fmtNum(w.value)}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--mint)" }}>
                      {numToWords(w.value)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--red)" }}>
                      あなたの回答: {w.answer ? fmtNum(parseInt(w.answer, 10)) : "（未入力）"}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {celebration && (
          <CelebrationModal
            tier={celebration.tier}
            title={celebration.title}
            message={celebration.message}
            points={celebration.points}
            onClose={() => setCelebration(null)}
          />
        )}
      </div>
    );
  }

  /* ---------------- 出題画面 ---------------- */
  return (
    <div className="space-y-5 animate-pop">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">{modeTitle}</h1>
          <p className="text-sm mt-1 font-mono" style={{ color: "var(--ink-soft)" }}>
            {speed.toFixed(1)}x・時間制限なし・全問正解で合格
          </p>
        </div>
        <GhostButton onClick={onBack} className="shrink-0">
          <ArrowLeft size={14} /> 中断する
        </GhostButton>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono font-semibold"
          style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
        >
          問題 {Math.min(qIndex + 1, total)} / {total}
        </span>
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono"
          style={{ backgroundColor: "var(--mint-soft)", color: "var(--mint)" }}
        >
          <Check size={14} /> 正解 {score}
        </span>
        <div className="flex-1 min-w-[100px]">
          <ProgressBar value={qIndex} max={total} color="var(--indigo)" height={8} />
        </div>
      </div>

      <Card className="p-6 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-2 py-1">
          <EqualizerBars active size={36} barCount={5} color="var(--indigo)" />
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            音声をよく聞いて、数字を入力しよう
          </p>
        </div>

        <button
          onClick={() => current && playCurrent(current.value)}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-full active:scale-95 transition-transform"
          style={{ backgroundColor: "var(--indigo-soft)", color: "var(--indigo)" }}
        >
          <Volume2 size={15} /> もう一度聞く（何度でもOK）
        </button>

        <div className="w-full max-w-xs flex flex-col items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="数字を入力"
            disabled={feedback === "correct"}
            className="w-full text-center font-mono text-3xl font-bold rounded-2xl px-4 py-3 border"
            style={{
              borderColor:
                feedback === "correct" ? "var(--mint)" : feedback === "wrong" ? "var(--red)" : "var(--line)",
              backgroundColor: "var(--bg-soft)",
              color: "var(--ink)",
            }}
          />
          <p className="font-mono text-xs h-4" style={{ color: "var(--ink-soft)" }}>
            {input ? fmtNum(parseInt(input, 10)) : "\u00A0"}
          </p>
        </div>

        {feedback === "correct" && (
          <p className="font-semibold text-sm" style={{ color: "var(--mint)" }}>
            正解！🎉
          </p>
        )}
        {feedback === "wrong" && (
          <div className="text-center space-y-1">
            <p className="font-semibold text-sm" style={{ color: "var(--red)" }}>
              残念… 正解は {current ? fmtNum(current.value) : ""}
            </p>
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              {current ? numToWords(current.value) : ""}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {feedback === "wrong" && input === "" ? (
            <IndigoButton onClick={proceed}>
              次へ <ChevronRight size={14} />
            </IndigoButton>
          ) : (
            <PrimaryButton onClick={submit} disabled={input === "" || feedback === "correct"}>
              <Check size={14} /> {feedback === "wrong" ? "もう一度答える" : "答える"}
            </PrimaryButton>
          )}
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
 * ルート
 * ======================================================================= */

export default function App() {
  const [tab, setTab] = useState("dashboard"); // "dashboard" | "word" | "sent" | "num" | "custom"
  const [section, setSection] = useState("learn"); // カテゴリ内の "learn" | "test"
  const [state, update] = useAppState();

  /* 開発者モード（全ステージ・全テストを解放して動作確認するためのモード）
   * 起動方法: URLの末尾に ?dev=1 を付けてアクセスする
   *   例) https://xxxx.github.io/ear100-test/?dev=1
   * 通常の利用では踏まないので、そのままのURLを配布すれば影響はない。
   * 学習データには一切影響せず、「解放されているかどうか」の表示だけを変える。 */
  const [devMode, setDevMode] = useState(() => {
    try {
      const q = window.location.search || "";
      const h = window.location.hash || "";
      return /[?&]dev=1/.test(q) || h === "#dev";
    } catch (e) {
      return false;
    }
  });
  // ホームの「つづきから」で学習画面を開くとき、開くステージを指定する（kindごと）
  const [focusStage, setFocusStage] = useState({ word: null, sent: null, num: null });
  // 特典セクション: サブタブ（特典1/2/3）と数字パート内カテゴリ（stage/time/money/phone）
  const [bonusTab, setBonusTab] = useState("t1");
  const [numPartCat, setNumPartCat] = useState("stage");

  // カテゴリタブと学習/テストを同時に指定して移動
  // 数字（num）は特典セクション内の数字パート（特典1・ステージ）へ集約したのでそこへ振り替える
  const goTo = (categoryTab, sec) => {
    if (categoryTab === "num") {
      setTab("bonus");
      setBonusTab("t1");
      setNumPartCat("stage");
      setSection(sec);
      return;
    }
    setTab(categoryTab);
    setSection(sec);
  };

  // 「つづきから学習する」: 次にやるべきステージを判定し、音読が必要なら学習・テスト待ちならテストへ飛ぶ
  const resumeLearning = (kind, stages) => {
    const target = stages.find((s) => s.unlocked && !s.cleared);
    if (!target) {
      // 全クリア済み: 学習画面を開く（復習用）
      setFocusStage((f) => ({ ...f, [kind]: null }));
      goTo(kind, "learn");
      return;
    }
    setFocusStage((f) => ({ ...f, [kind]: target.index }));
    // 音読が完了していてテスト合格だけ残っている → テスト画面へ、それ以外は学習画面へ
    goTo(kind, target.shadowDone >= target.shadowTotal ? "test" : "learn");
  };

  // 録音音声を起動時にプリロード（テスト出題時の読み込み待ちをなくす）
  useEffect(() => {
    // Web Audio用: 全速度分のバッファを事前デコード
    const allSpeeds = Array.from(new Set([...CONFIG.LEARN_SPEEDS, ...CONFIG.TEST_SPEEDS]));
    preloadWebAudioBuffers(WORDS, allSpeeds);
    preloadWebAudioBuffers(SENTENCES, allSpeeds);
    // HTMLAudioフォールバック用: 1.0x版もAudio要素でプリロード
    preloadAudio(WORDS);
    preloadAudio(SENTENCES);
  }, []);
  const { speak, cancel, makeUtterance, supported, voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice } = useSpeech();
  const voiceProps = { voices, englishVoices, voiceURI, setVoiceURI, hasEnglishVoice };

  const wordStages = useMemo(
    () => computeStages("word", WORDS, state, { alwaysUnlocked: devMode }),
    [state, devMode]
  );
  const sentStages = useMemo(
    () => computeStages("sent", SENTENCES, state, { alwaysUnlocked: devMode }),
    [state, devMode]
  );
  // 数字は桁数ベースのステージ分割（20個固定ではない）
  const numStages = useMemo(
    () => computeStages("num", NUMBERS, state, { chunks: NUM_STAGE_ITEMS, testLevels: 3, alwaysUnlocked: devMode }),
    [state, devMode]
  );
  // 数字パーツは①「表示中（＝解放済み）ステージ分だけ」を数字タブを開いたときに遅延プリロードする。
  // 全203×4速度を先読みしないことで起動を軽く保つ。数字は 0.5x 非対応（070/100/150/200 のみ）。
  useEffect(() => {
    if (tab !== "num") return;
    const numSpeeds = [0.7, 1.0, 1.5, 2.0];
    // 解放済みステージの全数字（音読＋テスト対象）を集めてパーツを先読み
    const items = numStages
      .filter((s) => s.unlocked || devMode)
      .flatMap((s) => s.items || []);
    if (items.length) preloadNumberParts(items, numSpeeds);
  }, [tab, numStages, devMode]);
  // 特典タブを開いたら extras（＋端数用の nums 100）スプライトを先読み
  useEffect(() => {
    if (tab === "bonus") preloadExtrasParts();
  }, [tab]);
  // マイリストはステージロックなし（登録した項目はすべてすぐ練習・テストできる）
  const customStages = useMemo(
    () => computeStages("custom", state.customItems, state, { alwaysUnlocked: true }),
    [state]
  );

  // 完全制覇のお祝い（単語100 / 例文100 / 全制覇）を一度だけ表示
  const [grandModal, setGrandModal] = useState(null);
  const wordAll = wordStages.every((s) => s.cleared);
  const sentAll = sentStages.every((s) => s.cleared);
  const numAll = numStages.every((s) => s.cleared);

  useEffect(() => {
    if (numAll && !state.celebrated.num) {
      update((prev) => withPoints(withCelebrated(prev, "num"), CONFIG.KIND_COMPLETE_BONUS));
      setGrandModal({
        tier: 6,
        title: "数字 完全マスター！",
        message: "5桁までの数字を耳だけで聞き取れるようになりました。すごい！",
        points: CONFIG.KIND_COMPLETE_BONUS,
      });
    }
  }, [numAll, state.celebrated, update]);

  useEffect(() => {
    if (wordAll && sentAll && !state.celebrated.grand) {
      update((prev) => withPoints(withCelebrated(withCelebrated(withCelebrated(prev, "grand"), "word"), "sent"), CONFIG.GRAND_COMPLETE_BONUS));
      setGrandModal({
        tier: 7,
        title: "🎊 完全制覇 🎊\n100単語＋100例文マスター",
        message: "すべてのステージテストに全問正解！ネイティブスピードの耳、完成です。本当におめでとう！",
        points: CONFIG.GRAND_COMPLETE_BONUS,
      });
      return;
    }
    if (wordAll && !state.celebrated.word) {
      update((prev) => withPoints(withCelebrated(prev, "word"), CONFIG.KIND_COMPLETE_BONUS));
      setGrandModal({
        tier: 6,
        title: "100単語 完全マスター！",
        message: "単語の全ステージテストに合格しました。次は100例文の完全制覇へ！",
        points: CONFIG.KIND_COMPLETE_BONUS,
      });
      return;
    }
    if (sentAll && !state.celebrated.sent) {
      update((prev) => withPoints(withCelebrated(prev, "sent"), CONFIG.KIND_COMPLETE_BONUS));
      setGrandModal({
        tier: 6,
        title: "100例文 完全マスター！",
        message: "例文の全ステージテストに合格しました。次は100単語の完全制覇へ！",
        points: CONFIG.KIND_COMPLETE_BONUS,
      });
    }
  }, [wordAll, sentAll, state.celebrated, update]);

  return (
    <div className="min-h-screen font-body" style={{ background: "var(--bg-grad)", color: "var(--ink)" }}>
      <GlobalStyle />
      <TopNav
        tab={tab}
        setTab={(id) => {
          setTab(id);
          setSection("learn"); // カテゴリを切り替えたら学習から開始
        }}
        points={state.totalPoints}
        streak={computeStreak(state.studyDays)}
      />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-16">
        {devMode && (
          <div
            className="mb-5 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3"
            style={{ backgroundColor: "var(--amber-soft)", color: "var(--amber)", border: "1px solid var(--amber)" }}
          >
            <AlertTriangle size={16} className="shrink-0" />
            <div className="flex-1 min-w-[200px] text-xs">
              <p className="font-semibold text-sm">開発者モード（全ステージ・全テスト解放中）</p>
              <p className="mt-0.5">
                動作確認用のモードです。ロックを無視してどのステージ・どのテストにも入れます。学習データはふだんどおり保存されます。
              </p>
            </div>
            <GhostButton
              onClick={() => {
                setDevMode(false);
                // URLからdev指定を消して、再読み込みしても通常モードに戻るようにする
                try {
                  if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, "", window.location.pathname);
                  }
                } catch (e) {
                  /* noop */
                }
              }}
              className="shrink-0"
            >
              通常モードに戻す
            </GhostButton>
          </div>
        )}
        {tab === "dashboard" && (
          <Dashboard
            state={state}
            setTab={setTab}
            goTo={goTo}
            wordStages={wordStages}
            sentStages={sentStages}
            numStages={numStages}
            onResume={resumeLearning}
            update={update}
          />
        )}

        {tab === "word" && (
          <div className="space-y-5">
            <SectionToggle section={section} setSection={setSection} color="var(--coral)" />
            {section === "learn" ? (
              <LearnScreen
                kind="word"
                stages={wordStages}
                state={state}
                update={update}
                speak={speak}
                cancel={cancel}
                makeUtterance={makeUtterance}
                supported={supported}
                onGoTest={() => setSection("test")}
                focusStageIndex={focusStage.word}
                onFocusApplied={() => setFocusStage((f) => ({ ...f, word: null }))}
                devMode={devMode}
                {...voiceProps}
              />
            ) : (
              <TestHub
                kind="word"
                items={WORDS}
                stages={wordStages}
                state={state}
                update={update}
                speak={speak}
                cancel={cancel}
                supported={supported}
                {...voiceProps}
                onExit={() => setSection("learn")}
                onHome={() => { setTab("dashboard"); setSection("learn"); }}
                onGoStageLearn={(i) => {
                  setFocusStage((f) => ({ ...f, word: i }));
                  setSection("learn");
                }}
                devMode={devMode}
              />
            )}
          </div>
        )}

        {tab === "sent" && (
          <div className="space-y-5">
            <SectionToggle section={section} setSection={setSection} color="var(--indigo)" />
            {section === "learn" ? (
              <LearnScreen
                kind="sent"
                stages={sentStages}
                state={state}
                update={update}
                speak={speak}
                cancel={cancel}
                makeUtterance={makeUtterance}
                supported={supported}
                onGoTest={() => setSection("test")}
                focusStageIndex={focusStage.sent}
                onFocusApplied={() => setFocusStage((f) => ({ ...f, sent: null }))}
                devMode={devMode}
                {...voiceProps}
              />
            ) : (
              <TestHub
                kind="sent"
                items={SENTENCES}
                stages={sentStages}
                state={state}
                update={update}
                speak={speak}
                cancel={cancel}
                supported={supported}
                {...voiceProps}
                onExit={() => setSection("learn")}
                onHome={() => { setTab("dashboard"); setSection("learn"); }}
                onGoStageLearn={(i) => {
                  setFocusStage((f) => ({ ...f, sent: i }));
                  setSection("learn");
                }}
                devMode={devMode}
              />
            )}
          </div>
        )}

        {tab === "bonus" && (
          <div className="space-y-5">
            {/* 特典1 / 特典2 / 特典3 */}
            <PillTabs
              tabs={BONUS_TOP_TABS}
              value={bonusTab}
              onChange={(v) => { cancel(); setBonusTab(v); }}
              color="var(--indigo)"
            />

            {bonusTab !== "t1" ? (
              <BonusComingSoon label={bonusTab === "t2" ? "特典2" : "特典3"} />
            ) : (
              <div className="space-y-5">
                {/* 数字パート: ステージ1〜5 → 時間 → お金 → 電話 */}
                <PillTabs
                  tabs={NUMPART_CATS}
                  value={numPartCat}
                  onChange={(v) => { cancel(); setNumPartCat(v); setSection("learn"); }}
                  color="var(--mint)"
                />
                <SectionToggle section={section} setSection={setSection} color="var(--mint)" />

                {numPartCat === "stage" && (
                  <p className="text-xs -mt-2" style={{ color: "var(--ink-soft)" }}>
                    ステージ1（1〜20）→ 2（2桁の聞き分け）→ 3（3桁）→ 4（4桁）→ 5（5桁）と桁数が増えていきます。
                  </p>
                )}

                {numPartCat === "stage" ? (
                  section === "learn" ? (
                    <div className="space-y-5">
                      <LearnScreen
                        kind="num"
                        stages={numStages}
                        stageLabels={NUM_STAGE_TITLES}
                        state={state}
                        update={update}
                        speak={speak}
                        cancel={cancel}
                        makeUtterance={makeUtterance}
                        supported={supported}
                        onGoTest={() => setSection("test")}
                        focusStageIndex={focusStage.num}
                        onFocusApplied={() => setFocusStage((f) => ({ ...f, num: null }))}
                        devMode={devMode}
                        renderStageExtra={(idx) =>
                          idx === 1 ? (
                            // ステージ2（2桁と聞き分け）を開いたときだけ、-teen/-ty聞き分けドリルを表示
                            <TeenTyDrill speak={speak} cancel={cancel} />
                          ) : null
                        }
                        {...voiceProps}
                      />
                    </div>
                  ) : (
                    <NumberTestHub
                      stages={numStages}
                      state={state}
                      update={update}
                      speak={speak}
                      cancel={cancel}
                      supported={supported}
                      {...voiceProps}
                      onExit={() => setSection("learn")}
                      onHome={() => { setTab("dashboard"); setSection("learn"); }}
                      onGoStageLearn={(idx) => {
                        setFocusStage((f) => ({ ...f, num: idx }));
                        setSection("learn");
                      }}
                      devMode={devMode}
                    />
                  )
                ) : (
                  <BonusCat mod={numPartCat} section={section} speak={speak} cancel={cancel} update={update} />
                )}
              </div>
            )}
          </div>
        )}

        {tab === "custom" && CONFIG.SHOW_CUSTOM && (
          <CustomScreen
            state={state}
            update={update}
            stages={customStages}
            wordAll={wordAll}
            sentAll={sentAll}
            stage1Cleared={wordStages[0].cleared || sentStages[0].cleared}
            speak={speak}
            cancel={cancel}
            makeUtterance={makeUtterance}
            supported={supported}
            {...voiceProps}
          />
        )}
      </main>
      {grandModal && (
        <CelebrationModal
          tier={grandModal.tier}
          title={grandModal.title}
          message={grandModal.message}
          points={grandModal.points}
          onClose={() => setGrandModal(null)}
          closeLabel="やったー！"
        />
      )}
      <footer className="text-center text-xs pb-8" style={{ color: "var(--ink-soft)" }}>
        学習データはこの端末のブラウザ内（localStorage）に保存されます。
      </footer>
    </div>
  );
}