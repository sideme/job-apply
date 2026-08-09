import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableDropdownOption {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
}

interface SearchableDropdownProps {
  value: string;
  options: SearchableDropdownOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  listClassName?: string;
  portalContainer?: HTMLElement | null;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  ariaLabel,
  disabled = false,
  triggerClassName,
  contentClassName,
  listClassName,
  portalContainer,
}) => {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  const selectedOption = options.find((option) => option.value === value);
  const triggerLabel = selectedOption?.label ?? placeholder;
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
  const filteredOptions = React.useMemo(
    () =>
      normalizedSearchTerm
        ? options.filter((option) =>
            [option.label, option.searchText ?? "", option.value].some((text) =>
              text.toLocaleLowerCase().includes(normalizedSearchTerm),
            ),
          )
        : options,
    [normalizedSearchTerm, options],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setSearchTerm("");
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? triggerLabel}
          disabled={disabled}
          className={cn("justify-between", triggerClassName)}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[320px] p-0", contentClassName)}
        container={portalContainer}
      >
        <Command label={searchPlaceholder} loop>
          <CommandInput
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
          <CommandList
            className={cn(
              "max-h-56 overflow-y-auto overscroll-contain",
              listClassName,
            )}
          >
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => {
                const selected = value === option.value;
                const searchableValue = [
                  option.label,
                  option.searchText ?? "",
                  option.value,
                ]
                  .join(" ")
                  .trim();

                return (
                  <CommandItem
                    key={option.value}
                    value={searchableValue}
                    disabled={option.disabled}
                    onSelect={() => {
                      onValueChange(option.value);
                      handleOpenChange(false);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
