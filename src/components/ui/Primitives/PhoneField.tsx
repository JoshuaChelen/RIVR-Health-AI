import React, { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { AppText } from "./AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radius, shadows, spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

// Renders an SVG country flag by ISO alpha-2 code (e.g. "US", "GB").
// Uses react-native-svg — no emoji, no font dependency, works reliably on iOS.
import * as FlagStrings from "country-flag-icons/string/3x2";

function FlagIcon({ code, size }: { code: string; size: number }) {
  const xml = (FlagStrings as Record<string, string>)[code];
  if (!xml) return null;
  // Flags are 3:2 ratio, so width = size * 1.5
  return <SvgXml xml={xml} width={size * 1.5} height={size} />;
}

// ─── Country list ─────────────────────────────────────────────────────────────

export type Country = { flag: string; dial: string; code: string; name: string };

export const COUNTRIES: Country[] = [
  { flag: "🇺🇸", dial: "+1", code: "US", name: "United States" },
  { flag: "🇦🇫", dial: "+93", code: "AF", name: "Afghanistan" },
  { flag: "🇦🇱", dial: "+355", code: "AL", name: "Albania" },
  { flag: "🇩🇿", dial: "+213", code: "DZ", name: "Algeria" },
  { flag: "🇦🇸", dial: "+1-684", code: "AS", name: "American Samoa" },
  { flag: "🇦🇩", dial: "+376", code: "AD", name: "Andorra" },
  { flag: "🇦🇴", dial: "+244", code: "AO", name: "Angola" },
  { flag: "🇦🇮", dial: "+1-264", code: "AI", name: "Anguilla" },
  { flag: "🇦🇶", dial: "+672", code: "AQ", name: "Antarctica" },
  { flag: "🇦🇬", dial: "+1-268", code: "AG", name: "Antigua and Barbuda" },
  { flag: "🇦🇷", dial: "+54", code: "AR", name: "Argentina" },
  { flag: "🇦🇲", dial: "+374", code: "AM", name: "Armenia" },
  { flag: "🇦🇼", dial: "+297", code: "AW", name: "Aruba" },
  { flag: "🇦🇺", dial: "+61", code: "AU", name: "Australia" },
  { flag: "🇦🇹", dial: "+43", code: "AT", name: "Austria" },
  { flag: "🇦🇿", dial: "+994", code: "AZ", name: "Azerbaijan" },
  { flag: "🇧🇸", dial: "+1-242", code: "BS", name: "Bahamas" },
  { flag: "🇧🇭", dial: "+973", code: "BH", name: "Bahrain" },
  { flag: "🇧🇩", dial: "+880", code: "BD", name: "Bangladesh" },
  { flag: "🇧🇧", dial: "+1-246", code: "BB", name: "Barbados" },
  { flag: "🇧🇾", dial: "+375", code: "BY", name: "Belarus" },
  { flag: "🇧🇪", dial: "+32", code: "BE", name: "Belgium" },
  { flag: "🇧🇿", dial: "+501", code: "BZ", name: "Belize" },
  { flag: "🇧🇯", dial: "+229", code: "BJ", name: "Benin" },
  { flag: "🇧🇲", dial: "+1-441", code: "BM", name: "Bermuda" },
  { flag: "🇧🇹", dial: "+975", code: "BT", name: "Bhutan" },
  { flag: "🇧🇴", dial: "+591", code: "BO", name: "Bolivia" },
  { flag: "🇧🇦", dial: "+387", code: "BA", name: "Bosnia and Herzegovina" },
  { flag: "🇧🇼", dial: "+267", code: "BW", name: "Botswana" },
  { flag: "🇧🇷", dial: "+55", code: "BR", name: "Brazil" },
  { flag: "🇮🇴", dial: "+246", code: "IO", name: "British Indian Ocean Territory" },
  { flag: "🇻🇬", dial: "+1-284", code: "VG", name: "British Virgin Islands" },
  { flag: "🇧🇳", dial: "+673", code: "BN", name: "Brunei" },
  { flag: "🇧🇬", dial: "+359", code: "BG", name: "Bulgaria" },
  { flag: "🇧🇫", dial: "+226", code: "BF", name: "Burkina Faso" },
  { flag: "🇧🇮", dial: "+257", code: "BI", name: "Burundi" },
  { flag: "🇰🇭", dial: "+855", code: "KH", name: "Cambodia" },
  { flag: "🇨🇲", dial: "+237", code: "CM", name: "Cameroon" },
  { flag: "🇨🇦", dial: "+1", code: "CA", name: "Canada" },
  { flag: "🇨🇻", dial: "+238", code: "CV", name: "Cape Verde" },
  { flag: "🇰🇾", dial: "+1-345", code: "KY", name: "Cayman Islands" },
  { flag: "🇨🇫", dial: "+236", code: "CF", name: "Central African Republic" },
  { flag: "🇹🇩", dial: "+235", code: "TD", name: "Chad" },
  { flag: "🇨🇱", dial: "+56", code: "CL", name: "Chile" },
  { flag: "🇨🇳", dial: "+86", code: "CN", name: "China" },
  { flag: "🇨🇽", dial: "+61", code: "CX", name: "Christmas Island" },
  { flag: "🇨🇨", dial: "+61", code: "CC", name: "Cocos Islands" },
  { flag: "🇨🇴", dial: "+57", code: "CO", name: "Colombia" },
  { flag: "🇰🇲", dial: "+269", code: "KM", name: "Comoros" },
  { flag: "🇨🇰", dial: "+682", code: "CK", name: "Cook Islands" },
  { flag: "🇨🇷", dial: "+506", code: "CR", name: "Costa Rica" },
  { flag: "🇭🇷", dial: "+385", code: "HR", name: "Croatia" },
  { flag: "🇨🇺", dial: "+53", code: "CU", name: "Cuba" },
  { flag: "🇨🇼", dial: "+599", code: "CW", name: "Curaçao" },
  { flag: "🇨🇾", dial: "+357", code: "CY", name: "Cyprus" },
  { flag: "🇨🇿", dial: "+420", code: "CZ", name: "Czech Republic" },
  { flag: "🇨🇩", dial: "+243", code: "CD", name: "Democratic Republic of the Congo" },
  { flag: "🇩🇰", dial: "+45", code: "DK", name: "Denmark" },
  { flag: "🇩🇯", dial: "+253", code: "DJ", name: "Djibouti" },
  { flag: "🇩🇲", dial: "+1-767", code: "DM", name: "Dominica" },
  { flag: "🇩🇴", dial: "+1-809", code: "DO", name: "Dominican Republic" },
  { flag: "🇪🇨", dial: "+593", code: "EC", name: "Ecuador" },
  { flag: "🇪🇬", dial: "+20", code: "EG", name: "Egypt" },
  { flag: "🇸🇻", dial: "+503", code: "SV", name: "El Salvador" },
  { flag: "🇬🇶", dial: "+240", code: "GQ", name: "Equatorial Guinea" },
  { flag: "🇪🇷", dial: "+291", code: "ER", name: "Eritrea" },
  { flag: "🇪🇪", dial: "+372", code: "EE", name: "Estonia" },
  { flag: "🇪🇹", dial: "+251", code: "ET", name: "Ethiopia" },
  { flag: "🇫🇰", dial: "+500", code: "FK", name: "Falkland Islands" },
  { flag: "🇫🇴", dial: "+298", code: "FO", name: "Faroe Islands" },
  { flag: "🇫🇯", dial: "+679", code: "FJ", name: "Fiji" },
  { flag: "🇫🇮", dial: "+358", code: "FI", name: "Finland" },
  { flag: "🇫🇷", dial: "+33", code: "FR", name: "France" },
  { flag: "🇵🇫", dial: "+689", code: "PF", name: "French Polynesia" },
  { flag: "🇬🇦", dial: "+241", code: "GA", name: "Gabon" },
  { flag: "🇬🇲", dial: "+220", code: "GM", name: "Gambia" },
  { flag: "🇬🇪", dial: "+995", code: "GE", name: "Georgia" },
  { flag: "🇩🇪", dial: "+49", code: "DE", name: "Germany" },
  { flag: "🇬🇭", dial: "+233", code: "GH", name: "Ghana" },
  { flag: "🇬🇮", dial: "+350", code: "GI", name: "Gibraltar" },
  { flag: "🇬🇷", dial: "+30", code: "GR", name: "Greece" },
  { flag: "🇬🇱", dial: "+299", code: "GL", name: "Greenland" },
  { flag: "🇬🇩", dial: "+1-473", code: "GD", name: "Grenada" },
  { flag: "🇬🇺", dial: "+1-671", code: "GU", name: "Guam" },
  { flag: "🇬🇹", dial: "+502", code: "GT", name: "Guatemala" },
  { flag: "🇬🇬", dial: "+44-1481", code: "GG", name: "Guernsey" },
  { flag: "🇬🇳", dial: "+224", code: "GN", name: "Guinea" },
  { flag: "🇬🇼", dial: "+245", code: "GW", name: "Guinea-Bissau" },
  { flag: "🇬🇾", dial: "+592", code: "GY", name: "Guyana" },
  { flag: "🇭🇹", dial: "+509", code: "HT", name: "Haiti" },
  { flag: "🇭🇳", dial: "+504", code: "HN", name: "Honduras" },
  { flag: "🇭🇰", dial: "+852", code: "HK", name: "Hong Kong" },
  { flag: "🇭🇺", dial: "+36", code: "HU", name: "Hungary" },
  { flag: "🇮🇸", dial: "+354", code: "IS", name: "Iceland" },
  { flag: "🇮🇳", dial: "+91", code: "IN", name: "India" },
  { flag: "🇮🇩", dial: "+62", code: "ID", name: "Indonesia" },
  { flag: "🇮🇷", dial: "+98", code: "IR", name: "Iran" },
  { flag: "🇮🇶", dial: "+964", code: "IQ", name: "Iraq" },
  { flag: "🇮🇪", dial: "+353", code: "IE", name: "Ireland" },
  { flag: "🇮🇲", dial: "+44-1624", code: "IM", name: "Isle of Man" },
  { flag: "🇮🇹", dial: "+39", code: "IT", name: "Italy" },
  { flag: "🇨🇮", dial: "+225", code: "CI", name: "Ivory Coast" },
  { flag: "🇯🇲", dial: "+1-876", code: "JM", name: "Jamaica" },
  { flag: "🇯🇵", dial: "+81", code: "JP", name: "Japan" },
  { flag: "🇯🇪", dial: "+44-1534", code: "JE", name: "Jersey" },
  { flag: "🇯🇴", dial: "+962", code: "JO", name: "Jordan" },
  { flag: "🇰🇿", dial: "+7", code: "KZ", name: "Kazakhstan" },
  { flag: "🇰🇪", dial: "+254", code: "KE", name: "Kenya" },
  { flag: "🇰🇮", dial: "+686", code: "KI", name: "Kiribati" },
  { flag: "🇽🇰", dial: "+383", code: "XK", name: "Kosovo" },
  { flag: "🇰🇼", dial: "+965", code: "KW", name: "Kuwait" },
  { flag: "🇰🇬", dial: "+996", code: "KG", name: "Kyrgyzstan" },
  { flag: "🇱🇦", dial: "+856", code: "LA", name: "Laos" },
  { flag: "🇱🇻", dial: "+371", code: "LV", name: "Latvia" },
  { flag: "🇱🇧", dial: "+961", code: "LB", name: "Lebanon" },
  { flag: "🇱🇸", dial: "+266", code: "LS", name: "Lesotho" },
  { flag: "🇱🇷", dial: "+231", code: "LR", name: "Liberia" },
  { flag: "🇱🇾", dial: "+218", code: "LY", name: "Libya" },
  { flag: "🇱🇮", dial: "+423", code: "LI", name: "Liechtenstein" },
  { flag: "🇱🇹", dial: "+370", code: "LT", name: "Lithuania" },
  { flag: "🇱🇺", dial: "+352", code: "LU", name: "Luxembourg" },
  { flag: "🇲🇴", dial: "+853", code: "MO", name: "Macao" },
  { flag: "🇲🇬", dial: "+261", code: "MG", name: "Madagascar" },
  { flag: "🇲🇼", dial: "+265", code: "MW", name: "Malawi" },
  { flag: "🇲🇾", dial: "+60", code: "MY", name: "Malaysia" },
  { flag: "🇲🇻", dial: "+960", code: "MV", name: "Maldives" },
  { flag: "🇲🇱", dial: "+223", code: "ML", name: "Mali" },
  { flag: "🇲🇹", dial: "+356", code: "MT", name: "Malta" },
  { flag: "🇲🇭", dial: "+692", code: "MH", name: "Marshall Islands" },
  { flag: "🇲🇷", dial: "+222", code: "MR", name: "Mauritania" },
  { flag: "🇲🇺", dial: "+230", code: "MU", name: "Mauritius" },
  { flag: "🇾🇹", dial: "+262", code: "YT", name: "Mayotte" },
  { flag: "🇲🇽", dial: "+52", code: "MX", name: "Mexico" },
  { flag: "🇫🇲", dial: "+691", code: "FM", name: "Micronesia" },
  { flag: "🇲🇩", dial: "+373", code: "MD", name: "Moldova" },
  { flag: "🇲🇨", dial: "+377", code: "MC", name: "Monaco" },
  { flag: "🇲🇳", dial: "+976", code: "MN", name: "Mongolia" },
  { flag: "🇲🇪", dial: "+382", code: "ME", name: "Montenegro" },
  { flag: "🇲🇸", dial: "+1-664", code: "MS", name: "Montserrat" },
  { flag: "🇲🇦", dial: "+212", code: "MA", name: "Morocco" },
  { flag: "🇲🇿", dial: "+258", code: "MZ", name: "Mozambique" },
  { flag: "🇲🇲", dial: "+95", code: "MM", name: "Myanmar" },
  { flag: "🇳🇦", dial: "+264", code: "NA", name: "Namibia" },
  { flag: "🇳🇷", dial: "+674", code: "NR", name: "Nauru" },
  { flag: "🇳🇵", dial: "+977", code: "NP", name: "Nepal" },
  { flag: "🇳🇱", dial: "+31", code: "NL", name: "Netherlands" },
  { flag: "🇦🇳", dial: "+599", code: "AN", name: "Netherlands Antilles" },
  { flag: "🇳🇨", dial: "+687", code: "NC", name: "New Caledonia" },
  { flag: "🇳🇿", dial: "+64", code: "NZ", name: "New Zealand" },
  { flag: "🇳🇮", dial: "+505", code: "NI", name: "Nicaragua" },
  { flag: "🇳🇪", dial: "+227", code: "NE", name: "Niger" },
  { flag: "🇳🇬", dial: "+234", code: "NG", name: "Nigeria" },
  { flag: "🇳🇺", dial: "+683", code: "NU", name: "Niue" },
  { flag: "🇰🇵", dial: "+850", code: "KP", name: "North Korea" },
  { flag: "🇲🇰", dial: "+389", code: "MK", name: "North Macedonia" },
  { flag: "🇲🇵", dial: "+1-670", code: "MP", name: "Northern Mariana Islands" },
  { flag: "🇳🇴", dial: "+47", code: "NO", name: "Norway" },
  { flag: "🇴🇲", dial: "+968", code: "OM", name: "Oman" },
  { flag: "🇵🇰", dial: "+92", code: "PK", name: "Pakistan" },
  { flag: "🇵🇼", dial: "+680", code: "PW", name: "Palau" },
  { flag: "🇵🇸", dial: "+970", code: "PS", name: "Palestine" },
  { flag: "🇵🇦", dial: "+507", code: "PA", name: "Panama" },
  { flag: "🇵🇬", dial: "+675", code: "PG", name: "Papua New Guinea" },
  { flag: "🇵🇾", dial: "+595", code: "PY", name: "Paraguay" },
  { flag: "🇵🇪", dial: "+51", code: "PE", name: "Peru" },
  { flag: "🇵🇭", dial: "+63", code: "PH", name: "Philippines" },
  { flag: "🇵🇳", dial: "+64", code: "PN", name: "Pitcairn" },
  { flag: "🇵🇱", dial: "+48", code: "PL", name: "Poland" },
  { flag: "🇵🇹", dial: "+351", code: "PT", name: "Portugal" },
  { flag: "🇵🇷", dial: "+1-787", code: "PR", name: "Puerto Rico" },
  { flag: "🇶🇦", dial: "+974", code: "QA", name: "Qatar" },
  { flag: "🇨🇬", dial: "+242", code: "CG", name: "Republic of the Congo" },
  { flag: "🇷🇴", dial: "+40", code: "RO", name: "Romania" },
  { flag: "🇷🇺", dial: "+7", code: "RU", name: "Russia" },
  { flag: "🇷🇼", dial: "+250", code: "RW", name: "Rwanda" },
  { flag: "🇷🇪", dial: "+262", code: "RE", name: "Réunion" },
  { flag: "🇧🇱", dial: "+590", code: "BL", name: "Saint Barthélemy" },
  { flag: "🇸🇭", dial: "+290", code: "SH", name: "Saint Helena" },
  { flag: "🇰🇳", dial: "+1-869", code: "KN", name: "Saint Kitts and Nevis" },
  { flag: "🇱🇨", dial: "+1-758", code: "LC", name: "Saint Lucia" },
  { flag: "🇲🇫", dial: "+590", code: "MF", name: "Saint Martin" },
  { flag: "🇵🇲", dial: "+508", code: "PM", name: "Saint Pierre and Miquelon" },
  { flag: "🇻🇨", dial: "+1-784", code: "VC", name: "Saint Vincent and the Grenadines" },
  { flag: "🇼🇸", dial: "+685", code: "WS", name: "Samoa" },
  { flag: "🇸🇲", dial: "+378", code: "SM", name: "San Marino" },
  { flag: "🇸🇦", dial: "+966", code: "SA", name: "Saudi Arabia" },
  { flag: "🇸🇳", dial: "+221", code: "SN", name: "Senegal" },
  { flag: "🇷🇸", dial: "+381", code: "RS", name: "Serbia" },
  { flag: "🇸🇨", dial: "+248", code: "SC", name: "Seychelles" },
  { flag: "🇸🇱", dial: "+232", code: "SL", name: "Sierra Leone" },
  { flag: "🇸🇬", dial: "+65", code: "SG", name: "Singapore" },
  { flag: "🇸🇽", dial: "+1-721", code: "SX", name: "Sint Maarten" },
  { flag: "🇸🇰", dial: "+421", code: "SK", name: "Slovakia" },
  { flag: "🇸🇮", dial: "+386", code: "SI", name: "Slovenia" },
  { flag: "🇸🇧", dial: "+677", code: "SB", name: "Solomon Islands" },
  { flag: "🇸🇴", dial: "+252", code: "SO", name: "Somalia" },
  { flag: "🇿🇦", dial: "+27", code: "ZA", name: "South Africa" },
  { flag: "🇰🇷", dial: "+82", code: "KR", name: "South Korea" },
  { flag: "🇸🇸", dial: "+211", code: "SS", name: "South Sudan" },
  { flag: "🇪🇸", dial: "+34", code: "ES", name: "Spain" },
  { flag: "🇱🇰", dial: "+94", code: "LK", name: "Sri Lanka" },
  { flag: "🇸🇩", dial: "+249", code: "SD", name: "Sudan" },
  { flag: "🇸🇷", dial: "+597", code: "SR", name: "Suriname" },
  { flag: "🇸🇯", dial: "+47", code: "SJ", name: "Svalbard and Jan Mayen" },
  { flag: "🇸🇿", dial: "+268", code: "SZ", name: "Swaziland" },
  { flag: "🇸🇪", dial: "+46", code: "SE", name: "Sweden" },
  { flag: "🇨🇭", dial: "+41", code: "CH", name: "Switzerland" },
  { flag: "🇸🇾", dial: "+963", code: "SY", name: "Syria" },
  { flag: "🇸🇹", dial: "+239", code: "ST", name: "São Tomé and Príncipe" },
  { flag: "🇹🇼", dial: "+886", code: "TW", name: "Taiwan" },
  { flag: "🇹🇯", dial: "+992", code: "TJ", name: "Tajikistan" },
  { flag: "🇹🇿", dial: "+255", code: "TZ", name: "Tanzania" },
  { flag: "🇹🇭", dial: "+66", code: "TH", name: "Thailand" },
  { flag: "🇹🇱", dial: "+670", code: "TL", name: "Timor-Leste" },
  { flag: "🇹🇬", dial: "+228", code: "TG", name: "Togo" },
  { flag: "🇹🇰", dial: "+690", code: "TK", name: "Tokelau" },
  { flag: "🇹🇴", dial: "+676", code: "TO", name: "Tonga" },
  { flag: "🇹🇹", dial: "+1-868", code: "TT", name: "Trinidad and Tobago" },
  { flag: "🇹🇳", dial: "+216", code: "TN", name: "Tunisia" },
  { flag: "🇹🇷", dial: "+90", code: "TR", name: "Turkey" },
  { flag: "🇹🇲", dial: "+993", code: "TM", name: "Turkmenistan" },
  { flag: "🇹🇨", dial: "+1-649", code: "TC", name: "Turks and Caicos Islands" },
  { flag: "🇹🇻", dial: "+688", code: "TV", name: "Tuvalu" },
  { flag: "🇻🇮", dial: "+1-340", code: "VI", name: "U.S. Virgin Islands" },
  { flag: "🇺🇬", dial: "+256", code: "UG", name: "Uganda" },
  { flag: "🇺🇦", dial: "+380", code: "UA", name: "Ukraine" },
  { flag: "🇦🇪", dial: "+971", code: "AE", name: "United Arab Emirates" },
  { flag: "🇬🇧", dial: "+44", code: "GB", name: "United Kingdom" },
  { flag: "🇺🇾", dial: "+598", code: "UY", name: "Uruguay" },
  { flag: "🇺🇿", dial: "+998", code: "UZ", name: "Uzbekistan" },
  { flag: "🇻🇺", dial: "+678", code: "VU", name: "Vanuatu" },
  { flag: "🇻🇦", dial: "+379", code: "VA", name: "Vatican" },
  { flag: "🇻🇪", dial: "+58", code: "VE", name: "Venezuela" },
  { flag: "🇻🇳", dial: "+84", code: "VN", name: "Vietnam" },
  { flag: "🇼🇫", dial: "+681", code: "WF", name: "Wallis and Futuna" },
  { flag: "🇪🇭", dial: "+212", code: "EH", name: "Western Sahara" },
  { flag: "🇾🇪", dial: "+967", code: "YE", name: "Yemen" },
  { flag: "🇿🇲", dial: "+260", code: "ZM", name: "Zambia" },
  { flag: "🇿🇼", dial: "+263", code: "ZW", name: "Zimbabwe" },
];


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a stored phone string like "+1 (555) 000-0000" → { country, number } */
export function parseStoredPhone(stored: string): { country: Country; number: string } {
  const defaultCountry = COUNTRIES[0]; // US
  if (!stored?.trim()) return { country: defaultCountry, number: "" };

  const ordered = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

  for (const c of ordered) {
    if (stored.startsWith(c.dial + " ")) {
      return { country: c, number: stored.slice(c.dial.length + 1) };
    }
    if (stored.startsWith(c.dial)) {
      return { country: c, number: stored.slice(c.dial.length) };
    }
  }

  return { country: defaultCountry, number: stored };
}

/** Format US number as (XXX) XXX-XXXX; other countries pass through */
function formatNumber(raw: string, dialCode: string): string {
  const digits = raw.replace(/\D/g, "");

  if (dialCode === "+1" || dialCode.startsWith("+1-")) {
    if (digits.length === 0) return "";
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  return raw;
}

// ─── PhoneField ───────────────────────────────────────────────────────────────

type Props = {
  label?: string;
  country: Country;
  number: string;
  onCountryChange: (c: Country) => void;
  onNumberChange: (n: string) => void;
  editable?: boolean;
  returnKeyType?: "next" | "done" | "default";
};

export function PhoneField({
  label,
  country,
  number,
  onCountryChange,
  onNumberChange,
  editable = true,
  returnKeyType = "done",
}: Props) {
  const pf = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused]   = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  function handleNumberChange(raw: string) {
    onNumberChange(formatNumber(raw, country.dial));
  }

  function handleCountrySelect(c: Country) {
    setShowPicker(false);
    // Reformat the existing number with the new dial code
    const digits = number.replace(/\D/g, "");
    onCountryChange(c);
    onNumberChange(formatNumber(digits, c.dial));
  }

  return (
    <View style={pf.container}>
      {label ? (
        <AppText variant="label" style={[pf.label, focused && pf.labelFocused]}>
          {label}
        </AppText>
      ) : null}

      <View style={[pf.wrap, focused && pf.wrapFocused]}>
        {/* Country prefix button */}
        <Pressable
          style={({ pressed }) => [pf.prefix, pressed && { opacity: 0.7 }]}
          onPress={() => editable && setShowPicker(true)}
          disabled={!editable}
        >
          <FlagIcon code={country.code} size={18} />
          <AppText style={pf.prefixDial}>{country.dial}</AppText>
          <Ionicons name="chevron-down" size={14} color={colors.muted} />
        </Pressable>

        <View style={pf.divider} />

        <TextInput
          style={pf.input}
          value={number}
          onChangeText={handleNumberChange}
          placeholder="(555) 000-0000"
          placeholderTextColor={colors.subtle}
          keyboardType="phone-pad"
          showSoftInputOnFocus
          returnKeyType={returnKeyType}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>

      {/* Country picker modal */}
      <Modal
        visible={showPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={pf.overlay} onPress={() => setShowPicker(false)} />
        <SafeAreaView style={pf.sheet}>
          <View style={pf.sheetHandle} />
          <AppText style={pf.sheetTitle}>Select country</AppText>
          <FlatList
            data={COUNTRIES}
            keyExtractor={(c) => c.code}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  pf.countryRow,
                  item.code === country.code && pf.countryRowSelected,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleCountrySelect(item)}
              >
                <FlagIcon code={item.code} size={22} />
                <AppText style={pf.countryName} numberOfLines={1}>{item.name}</AppText>
                <AppText style={pf.countryDial}>{item.dial}</AppText>
                {item.code === country.code && (
                  <View style={{ marginLeft: spacing.xs }}>
                    <Ionicons name="checkmark" size={16} color={colors.teal} />
                  </View>
                    )}
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={pf.separator} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
  container: { gap: 7 },
  label: { marginBottom: 1 },
  labelFocused: { color: c.teal },

  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    height: 52,
    ...shadows.xs,
  },
  wrapFocused: {
    borderColor: c.teal,
    borderWidth: 1.5,
    shadowColor: c.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  prefix: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 5,
    height: "100%" as any,
  },
  prefixFlag: { fontSize: 18, lineHeight: 24 },
  prefixDial: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.text,
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: c.border,
  },

  input: {
    flex: 1,
    height: "100%" as any,
    paddingHorizontal: 14,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: c.text,
  },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxHeight: "65%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: c.text,
    textAlign: "center",
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
    marginBottom: spacing.xs,
  },

  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  countryRowSelected: {
    backgroundColor: c.tealSoft,
  },
  countryFlag: { fontSize: 22, lineHeight: 28, flexShrink: 0 },
  countryName: {
    flex: 1,
    fontSize: typescale.size.base,
    color: c.text,
  },
  countryDial: {
    fontSize: typescale.size.sm,
    color: c.muted,
    flexShrink: 0,
  },
  separator: {
    height: 1,
    backgroundColor: c.borderLight,
    marginHorizontal: spacing.xs,
  },
}));
