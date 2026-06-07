import WidgetKit
import SwiftUI

// MARK: - Brand colors + helpers

enum BrandColor {
  static let teal = Color(hex: 0x1FADA6)
  static let emergency = Color(hex: 0xDC2626)
  static let text = Color(hex: 0x0D1B2A)
  static let muted = Color(hex: 0x64748B)
  static let background = Color("WidgetBackground")
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

extension View {
  /// iOS 17 requires containerBackground; earlier versions use a plain background.
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(color, for: .widget)
    } else {
      self.background(color)
    }
  }
}

private func listOrNone(_ values: [String]?) -> String {
  let cleaned = (values ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
  return cleaned.isEmpty ? "None listed" : cleaned.joined(separator: ", ")
}

private func relativeUpdated(_ iso: String?) -> String {
  guard let iso = iso else { return "" }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let date = formatter.date(from: iso)
    ?? { let f = ISO8601DateFormatter(); return f.date(from: iso) }()
  guard let date = date else { return "" }
  let rel = RelativeDateTimeFormatter()
  rel.unitsStyle = .short
  return "Updated " + rel.localizedString(for: date, relativeTo: Date())
}

// MARK: - Shared header + empty state

private struct WidgetHeader: View {
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "cross.case.fill").foregroundColor(BrandColor.emergency)
      Text("Emergency Card")
        .font(.caption).bold()
        .foregroundColor(BrandColor.text)
    }
  }
}

private struct EmptyState: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      WidgetHeader()
      Spacer()
      Text("Open RIVR to set up your Emergency Card.")
        .font(.caption2)
        .foregroundColor(BrandColor.muted)
      Spacer()
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

private struct Row: View {
  let label: String
  let value: String
  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      Text(label.uppercased())
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(BrandColor.muted)
        .frame(width: 64, alignment: .leading)
      Text(value)
        .font(.system(size: 11))
        .foregroundColor(BrandColor.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lineLimit(2)
    }
  }
}

// MARK: - Small (Teaser) — no PHI

struct TeaserView: View {
  let card: EmergencyCard?
  var body: some View {
    if card == nil {
      EmptyState()
    } else {
      VStack(alignment: .leading, spacing: 6) {
        WidgetHeader()
        Spacer()
        Text("Tap to view").font(.subheadline).bold().foregroundColor(BrandColor.teal)
        if !relativeUpdated(card?.updated_at).isEmpty {
          Text(relativeUpdated(card?.updated_at))
            .font(.system(size: 9)).foregroundColor(BrandColor.muted)
        }
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Medium (Critical) — blood type, allergies, ICE

struct CriticalView: View {
  let card: EmergencyCard?
  var body: some View {
    guard let card = card else { return AnyView(EmptyState()) }
    let contact = [card.emergency_contact?.name, card.emergency_contact?.phone]
      .compactMap { $0 }.joined(separator: "  ")
    return AnyView(
      VStack(alignment: .leading, spacing: 6) {
        WidgetHeader()
        Divider()
        Row(label: "Blood", value: card.blood_type ?? "Unknown")
        Row(label: "Allergies", value: listOrNone(card.allergies))
        Row(label: "ICE", value: contact.isEmpty ? "Not set" : contact)
        Spacer()
        Text(relativeUpdated(card.updated_at)).font(.system(size: 9)).foregroundColor(BrandColor.muted)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    )
  }
}

// MARK: - Large (Full) — everything

struct FullView: View {
  let card: EmergencyCard?
  var body: some View {
    guard let card = card else { return AnyView(EmptyState()) }
    let contact = [card.emergency_contact?.name, card.emergency_contact?.phone]
      .compactMap { $0 }.joined(separator: "  ")
    return AnyView(
      VStack(alignment: .leading, spacing: 4) {
        WidgetHeader()
        Divider()
        Row(label: "Blood", value: card.blood_type ?? "Unknown")
        Row(label: "Allergies", value: listOrNone(card.allergies))
        Row(label: "Meds", value: listOrNone(card.current_meds))
        Row(label: "Conditions", value: listOrNone(card.major_conditions))
        Row(label: "Anticoag.", value: listOrNone(card.anticoagulants))
        Row(label: "Implants", value: listOrNone(card.implants_devices))
        Row(label: "ICE", value: contact.isEmpty ? "Not set" : contact)
        if let summary = card.one_line_summary, !summary.isEmpty {
          Text(summary).font(.system(size: 10)).italic().foregroundColor(BrandColor.muted).lineLimit(2)
        }
        Spacer()
        Text(relativeUpdated(card.updated_at)).font(.system(size: 9)).foregroundColor(BrandColor.muted)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    )
  }
}
