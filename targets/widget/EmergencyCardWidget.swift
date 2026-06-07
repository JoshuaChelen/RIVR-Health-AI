import WidgetKit
import SwiftUI

let appGroup = "group.com.rivrhealth.app"
let storageKey = "emergency_card"
let widgetDeepLink = URL(string: "rivrhealth://health-summary")

// MARK: - Model (mirrors EmergencyCardWidgetPayload in mapping.ts)

struct EmergencyContact: Codable {
  let name: String?
  let phone: String?
}

struct EmergencyCard: Codable {
  let schema_version: Int?
  let blood_type: String?
  let allergies: [String]?
  let emergency_contact: EmergencyContact?
  let major_conditions: [String]?
  let current_meds: [String]?
  let anticoagulants: [String]?
  let implants_devices: [String]?
  let anesthesia_notes: [String]?
  let major_surgeries: [String]?
  let one_line_summary: String?
  let updated_at: String?
}

func loadEmergencyCard() -> EmergencyCard? {
  guard
    let defaults = UserDefaults(suiteName: appGroup),
    let raw = defaults.string(forKey: storageKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(EmergencyCard.self, from: data)
}

// MARK: - Timeline

struct CardEntry: TimelineEntry {
  let date: Date
  let card: EmergencyCard?
}

struct CardProvider: TimelineProvider {
  func placeholder(in context: Context) -> CardEntry {
    CardEntry(date: Date(), card: nil)
  }
  func getSnapshot(in context: Context, completion: @escaping (CardEntry) -> Void) {
    completion(CardEntry(date: Date(), card: loadEmergencyCard()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<CardEntry>) -> Void) {
    // Event-driven: a single entry, refreshed when the app calls reloadWidget().
    completion(Timeline(entries: [CardEntry(date: Date(), card: loadEmergencyCard())], policy: .never))
  }
}

// MARK: - Entry view (routes by size)

struct RivrWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  var entry: CardEntry

  var body: some View {
    Group {
      switch family {
      case .systemSmall: TeaserView(card: entry.card)
      case .systemLarge: FullView(card: entry.card)
      default: CriticalView(card: entry.card)
      }
    }
    .widgetBackground(BrandColor.background)
  }
}

// MARK: - Widget + bundle

struct RivrWidget: Widget {
  let kind = "RivrWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: CardProvider()) { entry in
      RivrWidgetEntryView(entry: entry)
        .widgetURL(widgetDeepLink)
    }
    .configurationDisplayName("Emergency Card")
    .description("Your 3×5 emergency medical card.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct RivrWidgetBundle: WidgetBundle {
  var body: some Widget {
    RivrWidget()
  }
}
