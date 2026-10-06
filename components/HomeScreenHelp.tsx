export function HomeScreenHelp() {
  return (
    <details className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600">
      <summary className="cursor-pointer py-3 font-semibold text-gray-800">Keep NutriTracker on your home screen</summary>
      <div className="space-y-2 pb-3 leading-relaxed">
        <p>On iPhone, open this page in Safari, tap Share, then Add to Home Screen. On Android, open the browser menu and choose Install app or Add to Home screen.</p>
        <p className="text-xs">An internet connection is needed to save meals. Unfinished meal drafts stay on this device for up to 24 hours and are cleared when you log out.</p>
      </div>
    </details>
  );
}
